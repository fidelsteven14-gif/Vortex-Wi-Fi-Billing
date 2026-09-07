<!-- Payment Loading / Status Modal Overlay -->
<div id="payment-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;">
    <div id="payment-modal-content" style="background:#111; border: 2px solid #22c55e; padding:30px; border-radius:12px; text-align:center; max-width:400px; width:90%; color:#fff; font-family:sans-serif;">
        <div id="spinner" style="border: 4px solid rgba(255,255,255,0.1); width: 40px; height: 40px; border-radius: 50%; border-left-color: #22c55e; animation: spin 1s linear infinite; margin: 0 auto 20px auto;"></div>
        <h3 id="modal-title" style="color: #22c55e; margin-bottom: 10px; font-size: 20px;">Processing Payment</h3>
        <p id="modal-message" style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">Sending M-Pesa STK push to your phone...</p>
    </div>
</div>

<style>
@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
</style>

<script>
// Function triggered when user clicks buy/pay on a package
async function triggerMpesaCheckout(packageId, tenantId) {
    const phoneInput = document.getElementById('phone-input').value.trim();
    
    // Basic validation
    if (!phoneInput || phoneInput.length < 9) {
        alert("Please enter a valid M-Pesa phone number.");
        return;
    }

    showPaymentModal("Processing Payment", "A prompt is being sent to your phone. Please enter your M-Pesa PIN.");

    try {
        const response = await fetch('/api/stk-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: phoneInput,
                packageId: packageId,
                tenantId: tenantId || "router1",
                macAddress: getClientMacAddress()
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to initiate STK push.');
        }

        // Clean prompt without revealing any backend till or routing info
        updateModalText(
            "Enter M-Pesa PIN", 
            "STK push sent successfully! Please check your phone, enter your M-Pesa PIN, and wait for confirmation."
        );

        // Start polling backend for webhook status confirmation
        pollPaymentStatus(data.checkout_request_id);

    } catch (error) {
        updateModalError(error.message);
    }
}

function pollPaymentStatus(checkoutId) {
    const startTime = Date.now();
    const timeoutLimit = 60000; // 60 seconds timeout

    const interval = setInterval(async () => {
        if (Date.now() - startTime > timeoutLimit) {
            clearInterval(interval);
            updateModalError("Payment confirmation timed out. If you entered your PIN, please try again.");
            return;
        }

        try {
            const res = await fetch(`/api/payment-status?checkout_id=${checkoutId}`);
            const result = await res.json();

            if (result.status === 'COMPLETE') {
                clearInterval(interval);
                showPaymentSuccess("Payment successful! Connecting you to the internet...");
                
                setTimeout(() => {
                    window.location.reload(); 
                }, 3000);

            } else if (result.status === 'FAILED') {
                clearInterval(interval);
                updateModalError("Payment failed or was cancelled. Please try again.");
            }
        } catch (err) {
            console.error("Polling check failed:", err);
        }
    }, 3000);
}

function showPaymentModal(title, message) {
    const modal = document.getElementById('payment-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    modal.style.display = 'flex';
}

function updateModalText(title, message) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
}

function showPaymentSuccess(message) {
    document.getElementById('spinner').style.display = 'none';
    const titleElem = document.getElementById('modal-title');
    titleElem.innerText = "Connected Successfully!";
    titleElem.style.color = "#22c55e";

    const msgElem = document.getElementById('modal-message');
    msgElem.innerText = message;
    msgElem.style.color = "#22c55e";
    msgElem.style.fontWeight = "bold";
}

function updateModalError(errorMessage) {
    document.getElementById('spinner').style.display = 'none';
    const titleElem = document.getElementById('modal-title');
    titleElem.innerText = "Payment Failed";
    titleElem.style.color = "#ef4444"; 

    const msgElem = document.getElementById('modal-message');
    msgElem.innerText = errorMessage;
    msgElem.style.color = "#fca5a5";

    setTimeout(() => {
        document.getElementById('payment-modal-content').innerHTML += `<button onclick="document.getElementById('payment-modal').style.display='none'" style="margin-top:15px; background:#ef4444; color:#fff; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Close</button>`;
    }, 500);
}

function getClientMacAddress() {
    return "00:00:00:00:00:00";
}
</script>
