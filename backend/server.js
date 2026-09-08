<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vortex Wi-Fi Billing - High-Speed Internet Access</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gradient-to-br from-purple-950 via-slate-900 to-maroon-950 text-white min-h-screen flex flex-col justify-between font-sans">

    <!-- Header / Branding -->
    <header class="w-full bg-gradient-to-r from-purple-900 via-maroon-900 to-orange-900 border-b border-orange-500/30 py-4 px-6 text-center shadow-xl">
        <h1 id="business-title" class="text-2xl font-black tracking-wider text-orange-400 drop-shadow-md">VORTEX HOTSPOT</h1>
        <p class="text-xs text-orange-200 mt-1">Customer Care: <a id="customer-care-link" href="tel:0113660340" class="text-green-300 underline font-semibold">0113660340</a></p>
    </header>

    <!-- Main Content Area -->
    <main class="flex-grow flex flex-col items-center justify-center p-4 max-w-md mx-auto w-full">
        <div class="w-full bg-slate-900/95 backdrop-blur-md border border-purple-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <div class="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-purple-500 via-orange-500 to-green-500"></div>

            <h2 class="text-xl font-extrabold text-center mb-2 text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-200">Select Internet Package</h2>
            <p class="text-xs text-slate-300 text-center mb-6">Choose a plan below and pay instantly via M-Pesa.</p>

            <!-- Packages Container -->
            <div id="packages-container" class="space-y-3 mb-6">
                <div class="animate-pulse bg-slate-800 h-16 rounded-2xl"></div>
                <div class="animate-pulse bg-slate-800 h-16 rounded-2xl"></div>
            </div>

            <!-- Phone Number Input Form -->
            <div id="payment-form-container" class="hidden space-y-4 border-t border-slate-800 pt-4">
                <div class="flex justify-between items-center text-sm bg-purple-950/50 p-3 rounded-xl border border-purple-800/50">
                    <span id="selected-package-name" class="font-semibold text-orange-200">Package: -</span>
                    <span id="selected-package-price" class="font-bold text-green-400 text-base">KSH 0</span>
                </div>
                <div>
                    <label class="block text-xs font-bold text-orange-300 mb-1">M-Pesa Phone Number</label>
                    <input type="tel" id="phone-input" placeholder="07XXXXXXXX or 01XXXXXXXX" 
                        class="w-full bg-slate-950 border border-purple-500/40 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors shadow-inner">
                </div>
                <div class="flex space-x-3 pt-2">
                    <button id="cancel-payment-btn" class="w-1/3 bg-rose-950 hover:bg-rose-900 border border-red-500/30 text-orange-200 py-3 rounded-xl text-sm font-semibold transition-colors shadow-md">
                        Back
                    </button>
                    <button id="pay-now-btn" class="w-2/3 bg-gradient-to-r from-orange-600 via-amber-600 to-green-600 hover:opacity-90 text-white py-3 rounded-xl text-sm font-extrabold shadow-lg shadow-orange-900/40 transition-all flex items-center justify-center">
                        Pay with M-Pesa
                    </button>
                </div>
            </div>
        </div>
    </main>

    <!-- Status / Loading Modal -->
    <div id="status-modal" class="fixed inset-0 bg-black/85 backdrop-blur-sm hidden items-center justify-center p-4 z-50">
        <div class="bg-slate-900 border border-purple-500/50 rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl relative overflow-hidden">
            <div class="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-purple-500 via-orange-500 to-green-500"></div>
            
            <div id="modal-spinner" class="inline-block w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4 mt-2"></div>
            
            <h3 id="modal-title" class="text-lg font-bold text-orange-300 mb-2">Processing Payment</h3>
            <p id="modal-message" class="text-xs text-slate-300 mb-6 leading-relaxed">Please check your phone and enter your M-Pesa PIN...</p>
            
            <button id="modal-close-btn" class="hidden w-full bg-rose-950 hover:bg-rose-900 border border-red-500/40 text-white py-3 rounded-xl text-xs font-bold transition-colors shadow-md">
                Dismiss / Try Again
            </button>
        </div>
    </div>

    <!-- Footer Navigation / Status Bar -->
    <footer class="w-full bg-slate-900 border-t border-purple-900/50 py-3 px-6 flex justify-around text-xs font-semibold text-slate-300">
        <span class="text-orange-400">PLANS</span>
        <span class="text-purple-300">VOUCHER</span>
        <span class="text-green-400">STATUS: <span id="connection-status" class="text-white">ONLINE</span></span>
    </footer>

    <!-- Front-End Application Logic Script -->
    <script>
        const API_BASE_URL = window.location.hostname.includes('github.io') 
            ? 'https://vortex-wi-fi-billing.onrender.com' 
            : '';

        const urlParams = new URLSearchParams(window.location.search);
        const macAddress = urlParams.get('mac') || urlParams.get('mac-address') || 'unknown';
        const tenantId = urlParams.get('tenant') || 'router1';

        let currentPackage = null;
        let pollInterval = null;

        document.addEventListener('DOMContentLoaded', () => {
            fetchTenantConfig();
            
            document.getElementById('cancel-payment-btn').addEventListener('click', resetView);
            document.getElementById('pay-now-btn').addEventListener('click', handleStkPushInitiation);
            document.getElementById('modal-close-btn').addEventListener('click', closeModal);
        });

        async function fetchTenantConfig() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/config/${tenantId}`);
                const data = await response.json();
                
                if (data.success && data.data) {
                    const tenant = data.data;
                    document.getElementById('business-title').textContent = tenant.businessName;
                    const careLink = document.getElementById('customer-care-link');
                    careLink.textContent = tenant.customerCare;
                    careLink.href = `tel:${tenant.customerCare}`;
                    
                    renderPackages(tenant.packages);
                } else {
                    renderFallbackPackages();
                }
            } catch (err) {
                console.error("Config fetch error:", err);
                renderFallbackPackages();
            }
        }

        function renderPackages(packages) {
            const container = document.getElementById('packages-container');
            container.innerHTML = '';

            packages.forEach(pkg => {
                const card = document.createElement('div');
                card.className = "flex justify-between items-center bg-gradient-to-r from-purple-950/60 to-slate-950 border border-purple-500/30 hover:border-orange-500 p-4 rounded-2xl cursor-pointer transition-all shadow-md group";
                card.innerHTML = `
                    <div>
                        <h4 class="font-extrabold text-sm text-orange-200 group-hover:text-orange-400 transition-colors">${pkg.name}</h4>
                        <p class="text-xs text-slate-400 mt-0.5">Instant high-speed Wi-Fi access</p>
                    </div>
                    <div class="text-right">
                        <span class="text-green-400 font-black text-sm bg-green-950/60 px-2.5 py-1 rounded-lg border border-green-500/30">KSH ${pkg.price}</span>
                        <div class="text-[10px] text-purple-300 mt-1 font-semibold">Select &rarr;</div>
                    </div>
                `;
                card.addEventListener('click', () => selectPackage(pkg));
                container.appendChild(card);
            });
        }

        function renderFallbackPackages() {
            renderPackages([
                { id: 1, name: "1 Hour Plan", price: 10, profile: "1_Hour_Package" },
                { id: 2, name: "24 Hours Plan", price: 50, profile: "24_Hours_Package" }
            ]);
        }

        function selectPackage(pkg) {
            currentPackage = pkg;
            document.getElementById('selected-package-name').textContent = `Package: ${pkg.name}`;
            document.getElementById('selected-package-price').textContent = `KSH ${pkg.price}`;
            
            document.getElementById('packages-container').classList.add('hidden');
            document.getElementById('payment-form-container').classList.remove('hidden');
        }

        function resetView() {
            currentPackage = null;
            document.getElementById('payment-form-container').classList.add('hidden');
            document.getElementById('packages-container').classList.remove('hidden');
        }

        async function handleStkPushInitiation() {
            const phoneInput = document.getElementById('phone-input').value.trim();
            
            if (!phoneInput || phoneInput.length < 10) {
                alert('Please enter a valid M-Pesa phone number.');
                return;
            }

            // Exact prompt matching your requirement
            showModal("Please enter your M-Pesa PIN", "Please check your phone and enter your M-Pesa PIN to complete the payment.", true);

            try {
                const response = await fetch(`${API_BASE_URL}/api/stk-push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: phoneInput,
                        packageId: currentPackage.id,
                        amount: currentPackage.price,
                        tenantId: tenantId,
                        macAddress: macAddress
                    })
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.message || 'Failed to initiate payment.');
                }

                startPollingStatus(data.checkout_request_id);

            } catch (err) {
                console.error("STK Request Error:", err);
                showModal("Payment Failed", err.message || "Network connection error. Check your connection and try again.", false, true);
            }
        }

        function startPollingStatus(checkoutId) {
            let attempts = 0;
            const maxAttempts = 35;

            pollInterval = setInterval(async () => {
                attempts++;
                if (attempts > maxAttempts) {
                    clearInterval(pollInterval);
                    showModal("Payment Timeout", "The payment request timed out. Please try again.", false, true);
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE_URL}/api/payment-status?checkout_id=${checkoutId}`);
                    const data = await response.json();

                    if (data.status === 'COMPLETE') {
                        clearInterval(pollInterval);
                        
                        // Step 1: Payment received notification
                        showModal("Payment Received", "Payment received, connecting to the internet...", true, false);

                        // Step 2: Final connected successfully notification after short delay
                        setTimeout(() => {
                            showModal("Connected Successfully!", "You are now successfully connected to high-speed internet.", false, false);
                            setTimeout(() => {
                                window.location.reload();
                            }, 2500);
                        }, 2000);

                    } else if (data.status === 'FAILED') {
                        clearInterval(pollInterval);
                        showModal("Payment Failed", data.message || "The payment transaction was cancelled or failed.", false, true);
                    }
                } catch (err) {
                    console.error("Polling error:", err);
                }
            }, 3000);
        }

        function showModal(title, message, showSpinner, showCloseBtn) {
            const modal = document.getElementById('status-modal');
            const spinner = document.getElementById('modal-spinner');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const closeBtn = document.getElementById('modal-close-btn');

            titleEl.textContent = title;
            msgEl.textContent = message;

            if (showSpinner) {
                spinner.classList.remove('hidden');
                closeBtn.classList.add('hidden');
            } else {
                spinner.classList.add('hidden');
                if (showCloseBtn) {
                    closeBtn.classList.remove('hidden');
                } else {
                    closeBtn.classList.add('hidden');
                }
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeModal() {
            if (pollInterval) clearInterval(pollInterval);
            const modal = document.getElementById('status-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resetView();
        }
    </script>
</body>
</html>
