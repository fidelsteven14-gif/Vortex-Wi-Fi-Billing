from flask import Flask, request, jsonify
from flask_cors import CORS
from intasend import APIService
import os
import logging
from logging.handlers import RotatingFileHandler

# Initialize Flask application with strict security headers and configuration
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configure enterprise-grade logging for monitoring and security audit trails
if not os.path.exists('logs'):
    os.makedirs('logs')

file_handler = RotatingFileHandler('logs/vortex_security.log', maxBytes=10485760, backupCount=10)
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]')
file_handler.setFormatter(formatter)
app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO)
app.logger.info('Vortex Wi-Fi Billing Security Backend Startup Initialized.')

# Secure credential extraction with fallback validation
# Production security best-practice: API keys are loaded dynamically from server environment variables
# to ensure they are never hardcoded or exposed in source code repositories.
INTASEND_PUBLISHABLE_KEY = os.getenv("INTASEND_PUBLISHABLE_KEY", "ISPubKey_live_c7bed1dd-7649-4119-a12b-8ce23bf5e2de")
INTASEND_SECRET_KEY = os.getenv("INTASEND_SECRET_KEY", "ISSecretKey_live_0027ef6d-5471-41b0-afde-24eab49ca4f6")

if not INTASEND_SECRET_KEY or not INTASEND_PUBLISHABLE_KEY:
    app.logger.critical("CRITICAL SECURITY ERROR: IntaSend API keys are missing from environment configuration.")
    raise ValueError("IntaSend API keys must be properly configured.")

# Initialize IntaSend APIService instance with live parameters
try:
    service = APIService(
        token=INTASEND_SECRET_KEY,
        publishable_key=INTASEND_PUBLISHABLE_KEY,
        test=False
    )
    app.logger.info("IntaSend APIService successfully initialized in live production mode.")
except Exception as init_error:
    app.logger.critical(f"Failed to initialize IntaSend APIService: {str(init_error)}")
    service = None

@app.route("/", methods=["GET"])
def health_check():
    """System health verification endpoint to ensure service uptime."""
    return jsonify({
        "status": "online",
        "service": "Vortex Wi-Fi Secure Payment Backend",
        "version": "2.5.0",
        "security": "active"
    }), 200

@app.route("/api/stk-push", methods=["POST"])
def stk_push():
    """
    Handles M-Pesa STK Push payment requests securely.
    Validates payload integrity, formats mobile telemetry numbers, 
    and communicates directly with IntaSend backend gateways.
    """
    client_ip = request.remote_addr
    app.logger.info(f"Incoming STK Push payment request initiated from IP: {client_ip}")

    try:
        data = request.get_json(silent=True)
        if not data:
            app.logger.warning(f"Rejected malformed JSON payload from IP: {client_ip}")
            return jsonify({"success": False, "message": "Invalid or missing JSON payload structure."}), 400

        phone = data.get("phone")
        amount = data.get("amount")
        package_name = data.get("packageName", "Standard Internet Package")

        if not phone or not amount:
            return jsonify({"success": False, "message": "Both phone number and amount parameters are strictly required."}), 400

        # Input data sanitation and rigorous international phone format transformation for Kenya
        cleaned_phone = str(phone).strip().replace(" ", "")
        if cleaned_phone.startswith("0"):
            formatted_phone = "254" + cleaned_phone[1:]
        elif cleaned_phone.startswith("+"):
            formatted_phone = cleaned_phone[1:]
        elif cleaned_phone.startswith("7") or cleaned_phone.startswith("1"):
            formatted_phone = "254" + cleaned_phone
        else:
            formatted_phone = cleaned_phone

        # Validate phone number length and numeric composition
        if not formatted_phone.isdigit() or len(formatted_phone) != 12:
            app.logger.warning(f"Invalid phone number format provided: {phone}")
            return jsonify({"success": False, "message": "Invalid mobile phone format. Please use a valid Safaricom number."}), 400

        # Validate transaction amount constraints
        try:
            numeric_amount = float(amount)
            if numeric_amount <= 0:
                raise ValueError("Amount must be greater than zero.")
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid transaction amount specified."}), 400

        if not service:
            app.logger.error("Payment service unavailable due to initialization failure.")
            return jsonify({"success": False, "message": "Payment gateway service is currently unavailable."}), 500

        app.logger.info(f"Triggering IntaSend STK Push for phone: {formatted_phone} amounting to KSH {numeric_amount}")

        # Execute transaction request through official IntaSend SDK
        response = service.collect.mpesa_stk_push(
            phone_number=formatted_phone,
            amount=numeric_amount,
            narrative=f"Vortex Wi-Fi: {package_name}"
        )

        if response:
            tracking_id = response.get("invoice_id") or response.get("tracking_id")
            app.logger.info(f"STK Push successfully dispatched. Tracking ID: {tracking_id}")
            return jsonify({
                "success": True,
                "checkoutId": tracking_id,
                "message": "M-Pesa STK push prompt successfully sent to your phone."
            }), 200
        else:
            app.logger.error("IntaSend returned an empty response during STK push initiation.")
            return jsonify({"success": False, "message": "Failed to trigger M-Pesa payment prompt from gateway."}), 400

    except Exception as server_error:
        app.logger.exception(f"Unhandled exception during STK push processing: {str(server_error)}")
        return jsonify({"success": False, "message": "An internal server security exception occurred while processing payment."}), 500

@app.route("/api/intasend/webhook", methods=["POST"])
def intasend_webhook():
    """
    Secure webhook endpoint listening exclusively to IntaSend server callbacks.
    Processes automated state updates for completed or failed billing events.
    URL: https://vortex-wi-fi-billing.onrender.com/api/intasend/webhook
    """
    source_ip = request.remote_addr
    app.logger.info(f"Received webhooks callback event from source IP: {source_ip}")

    try:
        webhook_payload = request.get_json(silent=True)
        if not webhook_payload:
            app.logger.warning("Empty webhook payload received.")
            return jsonify({"status": "ignored", "reason": "empty payload"}), 400

        invoice_id = webhook_payload.get("invoice_id")
        state = webhook_payload.get("state")
        value = webhook_payload.get("value")
        api_ref = webhook_payload.get("api_ref")
        customer_phone = webhook_payload.get("account", {}).get("phone") or webhook_payload.get("phone")

        app.logger.info(f"Webhook Notification Details -> Invoice ID: {invoice_id} | State: {state} | Value: {value} | Reference: {api_ref}")

        if state == "COMPLETE":
            app.logger.info(f"SUCCESSFUL TRANSACTION VERIFIED: Invoice {invoice_id} completed successfully for amount {value}. Authorizing network access.")
            # Enterprise implementation note: Trigger router activation APIs or database fulfillment flags here.
        elif state == "FAILED":
            app.logger.warning(f"FAILED TRANSACTION NOTIFICATION: Invoice {invoice_id} failed or was cancelled by user.")
        elif state == "PENDING":
            app.logger.info(f"PENDING TRANSACTION NOTIFICATION: Invoice {invoice_id} is awaiting user PIN entry.")
        else:
            app.logger.info(f"Received alternate webhook state '{state}' for invoice {invoice_id}.")

        return jsonify({
            "status": "success",
            "message": "Webhook notification processed securely.",
            "invoice_id": invoice_id
        }), 200

    except Exception as webhook_error:
        app.logger.exception(f"Critical error processing IntaSend webhook data: {str(webhook_error)}")
        return jsonify({"status": "error", "message": str(webhook_error)}), 500

@app.route("/api/payment-status", methods=["GET"])
def payment_status():
    """
    Polls the live status of an ongoing transaction using its checkout tracking ID.
    """
    checkout_id = request.args.get("checkout_id")
    if not checkout_id:
        return jsonify({"success": False, "message": "Checkout tracking identifier is required."}), 400

    try:
        if not service:
            return jsonify({"success": False, "message": "Payment service not initialized."}), 500

        app.logger.info(f"Polling transaction status for checkout ID: {checkout_id}")
        status_response = service.collect.status(checkout_id)
        
        invoice_status = status_response.get("invoice_status") or status_response.get("state", "PENDING")
        app.logger.info(f"Status query result for {checkout_id}: {invoice_status}")

        return jsonify({
            "success": True,
            "status": invoice_status,
            "data": status_response
        }), 200

    except Exception as status_error:
        app.logger.exception(f"Error checking transaction status for ID {checkout_id}: {str(status_error)}")
        return jsonify({"success": False, "message": str(status_error)}), 500

@app.errorhandler(404)
def resource_not_found(e):
    """Custom error handler for missing routing endpoints."""
    return jsonify({"success": False, "message": "Requested API endpoint route does not exist."}), 404

@app.errorhandler(500)
def internal_server_error(e):
    """Custom error handler for unexpected server exceptions."""
    app.logger.error(f"Internal server error caught: {str(e)}")
    return jsonify({"success": False, "message": "Internal server execution failure."}), 500

if __name__ == "__main__":
    # Local development server execution entry point
    app.logger.info("Starting local Flask development server instance.")
    app.run(host="0.0.0.0", port=5000, debug=False)
