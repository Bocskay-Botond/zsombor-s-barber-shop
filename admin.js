// --- Biztonsági ellenőrzés ---
// Ha a felhasználó nincs bejelentkezve, átirányítjuk a login oldalra.
if (localStorage.getItem('isLoggedIn') !== 'true') {
    window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', function () {

    /**
     * Toast értesítés megjelenítése
     */
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';

        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);

        // Automatikus eltávolítás az animáció után
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // --- Currency Conversion System ---
    // Exchange rates (HUF as base currency)
    const EXCHANGE_RATES = {
        'Ft': 1,        // HUF (base)
        'EUR': 0.0025,  // ~400 HUF/EUR
        'USD': 0.0028,  // ~360 HUF/USD
        '€': 0.0025,    // Alias for EUR
        '$': 0.0028     // Alias for USD
    };

    /**
     * Converts HUF amount to target currency and formats it
     * @param {number} amountInHUF - Base amount in HUF
     * @param {string} targetCurrency - Target currency symbol ('Ft', 'EUR', 'USD', etc.)
     * @returns {number} Converted amount
     */
    function convertCurrency(amountInHUF, targetCurrency) {
        const rate = EXCHANGE_RATES[targetCurrency] || 1;
        const converted = amountInHUF * rate;

        // Format based on currency (EUR/USD: 2 decimals, HUF: 0 decimals)
        if (targetCurrency === 'Ft') {
            return Math.round(converted);
        }
        return Math.round(converted * 100) / 100; // 2 decimal places
    }

    // --- Data Manager (Perzisztencia réteg) ---
    class DataManager {
        constructor() {
            this.bookings = this.loadData('bookings') || [];
            this.settings = this.loadData('settings') || {
                shopName: 'StyleMasters',
                currency: 'Ft',
                products: [
                    { id: 1, name: 'Férfi hajvágás', price: 8000, image: '' },
                    { id: 2, name: 'Szakálligazítás', price: 4500, image: '' },
                    { id: 3, name: 'Hajfestés', price: 12000, image: '' }
                ]
            };
        }

        loadData(key) {
            return JSON.parse(localStorage.getItem(key));
        }

        saveData(key, data) {
            localStorage.setItem(key, JSON.stringify(data));
        }

        getBookings() {
            return this.bookings;
        }

        addBooking(booking) {
            this.bookings.push(booking);
            this.saveData('bookings', this.bookings);
        }

        removeBooking(id) {
            this.bookings = this.bookings.filter(b => b.id !== id);
            this.saveData('bookings', this.bookings);
        }

        updateStatus(id, newStatus) {
            const booking = this.bookings.find(b => b.id === id);
            if (booking) {
                booking.status = newStatus;
                this.saveData('bookings', this.bookings);
            }
        }

        // Statisztikák kinyerése
        getStats() {
            const today = new Date().toLocaleDateString('hu-HU');
            const todaysBookings = this.bookings.filter(b => b.time && b.time.startsWith(today) && b.status !== 'Elutasítva');

            const revenue = todaysBookings.reduce((sum, b) => sum + (b.price || 0), 0);

            // Comparison logic (mock implementation for now, or based on random history if we had it)
            // Valós history nélkül nehéz összehasonlítani, de itt lehetne implementálni

            return {
                dailyRevenue: revenue,
                pendingCount: this.bookings.filter(b => b.status === 'Várakozik').length,
                completedCount: this.bookings.filter(b => b.status === 'Megerősítve').length
            };
        }

        getWeeklyRevenue(dates) {
            return dates.map(dateStr => {
                // dateStr expected to be "YYYY. MM. DD." (or matching hu-HU localestring start)
                // Note: We use startsWith to match just the date part if time is included in standard storage
                const dayRevenue = this.bookings
                    .filter(b => b.time && b.time.startsWith(dateStr) && b.status !== 'Elutasítva')
                    .reduce((sum, b) => sum + (b.price || 0), 0);
                // console.log(`Checking date: ${dateStr}, Revenue: ${dayRevenue}`); // Debug
                return dayRevenue;
            });
        }

        // Ügyfelek listája (deduplikálva email alapján)
        getCustomers() {
            const customers = new Map();
            this.bookings.forEach(b => {
                if (!customers.has(b.email)) {
                    customers.set(b.email, { name: b.guestName, email: b.email, lastVisit: b.time });
                }
            });
            return Array.from(customers.values());
        }

        // --- Product Management Methods ---
        getProducts() {
            return this.settings.products || [];
        }

        addProduct(product) {
            if (!this.settings.products) {
                this.settings.products = [];
            }
            // Generate new ID
            const maxId = this.settings.products.reduce((max, p) => Math.max(max, p.id), 0);
            product.id = maxId + 1;
            this.settings.products.push(product);
            this.saveData('settings', this.settings);
        }

        updateProduct(id, updatedProduct) {
            const index = this.settings.products.findIndex(p => p.id === id);
            if (index !== -1) {
                this.settings.products[index] = { ...this.settings.products[index], ...updatedProduct };
                this.saveData('settings', this.settings);
            }
        }

        deleteProduct(id) {
            this.settings.products = this.settings.products.filter(p => p.id !== id);
            this.saveData('settings', this.settings);
        }
    }

    const dataManager = new DataManager();
    const tableBody = document.getElementById('bookings-table-body');

    // Státusz osztályok a CSS-hez
    const statusClasses = {
        'Várakozik': 'status-waiting',
        'Megerősítve': 'status-confirmed',
        'Elutasítva': 'status-rejected'
    };

    /**
     * Rendereli a foglalási adatokat a HTML táblázatba.
     */
    function renderBookings() {
        if (!tableBody) return;
        tableBody.innerHTML = ''; // Táblázat ürítése renderelés előtt

        const currentBookings = dataManager.getBookings();

        if (currentBookings.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Nincsenek aktuális foglalások.</td></tr>';
            return;
        }

        currentBookings.forEach(booking => {
            const row = document.createElement('tr');
            row.setAttribute('data-id', booking.id);

            const statusClass = statusClasses[booking.status] || '';
            const currency = dataManager.settings.currency || 'Ft';
            const convertedPrice = convertCurrency(booking.price || 0, currency);

            row.innerHTML = `
                <td>${booking.guestName}</td>
                <td>${booking.service}</td>
                <td>${booking.time}</td>
                <td>${convertedPrice.toLocaleString('hu-HU')} ${currency}</td>
                <td><span class="status ${statusClass}">${booking.status}</span></td>
                <td>
                    <button class="btn btn-accept" title="Elfogad">✔</button>
                    <button class="btn btn-reject" title="Elutasít">✖</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
        updateDashboardStats();
    }

    /**
     * Frissíti a dashboard statisztikáit
     */
    function updateDashboardStats() {
        const stats = dataManager.getStats();

        // Elemek kiválasztása (feltételezve, hogy az admin.html-ben ezek a kártyák sorrendben vannak)
        const cards = document.querySelectorAll('.stats-cards .card');
        const currency = dataManager.settings.currency || 'Ft'; // Default currency

        if (cards.length >= 3) {
            const convertedRevenue = convertCurrency(stats.dailyRevenue, currency);
            cards[0].querySelector('.stat-number').textContent = `${convertedRevenue.toLocaleString('hu-HU')} ${currency}`;
            cards[1].querySelector('.stat-number').textContent = stats.pendingCount;
            cards[2].querySelector('.stat-number').textContent = stats.completedCount;
        }
    }

    /**
     * Eseménykezelés a gombokhoz (event delegation), frissíti a localStorage-t is.
     */
    function setupEventListeners() {
        if (!tableBody) return;

        tableBody.addEventListener('click', function (e) {
            // Handle 'Részletek' button for Customers
            const detailsBtn = e.target.closest('button[title="Részletek"]');
            if (detailsBtn) {
                const row = detailsBtn.closest('tr');
                const name = row.children[0].textContent;
                const email = row.children[1].textContent;
                showToast(`Ügyfél: ${name}<br>Email: ${email}`, 'info');
                return;
            }

            const button = e.target.closest('button');
            if (!button) return;

            const row = button.closest('tr');
            if (!row) return;

            const bookingId = Number(row.dataset.id);

            // Handle Accept (Complete) Action
            if (button.classList.contains('btn-accept')) {
                dataManager.updateStatus(bookingId, 'Megerősítve');

                // Frissítés: renderelés újra, hogy a státusz frissüljön
                renderBookings();
                // A renderBookings hívja az updateDashboardStats-t is, 
                // de a biztoság kedvéért a chartot is frissíteni kell, ha a bevételt érinti
                renderChart();
                return;
            }

            // Handle Reject (Remove) Action
            if (button.classList.contains('btn-reject')) {
                dataManager.removeBooking(bookingId); // Eltávolítás

                // Sor eltávolítása a DOM-ból animációval
                row.classList.add('row-fade-out');
                setTimeout(() => {
                    row.remove(); // Törlés a DOM-ból

                    const bookings = dataManager.getBookings();
                    if (bookings.length === 0) {
                        renderBookings(); // Ha üres, "Nincs adat" üzenet
                    } else {
                        updateDashboardStats(); // Statisztikák frissítése
                        renderChart(); // Chart frissítése (ha töröltük a bevételt)
                    }
                }, 300); // 300ms a CSS transition-höz igazítva (amit most nem módosítottunk, de kb ennyi szokott lenni)
                return;
            }
        });
    }


    // --- Új funkció: Oldalsáv navigáció kezelése (füles nézet) ---
    function setupSidebarNavigation() {
        const sidebarLinks = document.querySelectorAll('.sidebar-nav a[href^="#"]');
        const adminSections = document.querySelectorAll('.admin-section');

        // Sidebar hover auto-collapse logic
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.addEventListener('mouseenter', () => {
                sidebar.classList.remove('collapsed');
            });
            sidebar.addEventListener('mouseleave', () => {
                sidebar.classList.add('collapsed');
            });
        }

        function showSection(targetId) {
            if (!targetId || targetId === '#' || !targetId.startsWith('#')) return;

            adminSections.forEach(section => {
                section.classList.add('hidden');
            });

            const targetSection = document.querySelector(targetId);
            if (targetSection) {
                targetSection.classList.remove('hidden');
                // Ha a foglalások szekciót mutatjuk, rendereljük újra a foglalásokat
                if (targetId === '#bookings-section') {
                    renderBookings();
                } else if (targetId === '#clients-section') {
                    renderCustomers();
                } else if (targetId === '#settings-section') {
                    loadSettings();
                }
                // Görgetés a szekcióhoz (hogy a táblázat teteje látható legyen)
                /* targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                }); */
            }
        }

        // Kezdeti állapot: az aktív menüpont szerinti szekció látható
        const initialActiveLink = document.querySelector('.sidebar-nav li.active a');
        if (initialActiveLink) {
            showSection(initialActiveLink.getAttribute('href'));
        }


        sidebarLinks.forEach(link => {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');

                // Aktív osztályok kezelése
                document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
                this.closest('li').classList.add('active');

                showSection(targetId);
            });
        });
    }

    // --- Új funkció: Kijelentkezés ---
    function setupLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function (e) {
                e.preventDefault();
                // Kijelentkezési állapot mentése
                localStorage.removeItem('isLoggedIn');
                // Átirányítás a login oldalra
                window.location.href = 'login.html';
            });
        }
    }


    // --- Új funkció: Chart.js Diagram ---



    function getCurrentWeekDays() {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
        // Make Monday index 0
        const currentDayIndex = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;

        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - currentDayIndex);

        const days = [];
        const dateStrings = [];

        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);

            // UI Label: Jan 12
            const label = date.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
            days.push(label);

            // Filter Key: 2026. 01. 12.
            // We must construct this to match what toLocaleString('hu-HU') outputs in script.js
            // script.js: new Date().toLocaleString('hu-HU') -> "2026. 01. 12. 14:00:00"
            // So we need "2026. 01. 12."
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            dateStrings.push(`${year}. ${month}. ${day}.`);
        }
        return { labels: days, dateFilters: dateStrings };
    }

    let revenueChartInstance = null; // Store globally to destroy properly

    function renderChart() {
        const canvas = document.getElementById('revenueChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const settings = dataManager.settings;
        const currency = settings.currency || 'Ft';

        const { labels, dateFilters } = getCurrentWeekDays();
        const revenueData = dataManager.getWeeklyRevenue(dateFilters);

        // Convert revenue data to selected currency
        const convertedData = revenueData.map(val => convertCurrency(val, currency));

        if (revenueChartInstance) {
            revenueChartInstance.destroy();
        }

        revenueChartInstance = new Chart(ctx, {
            type: 'line', // Line chart looks better for trends
            data: {
                labels: labels,
                datasets: [{
                    label: `Bevétel (${currency})`,
                    data: convertedData,
                    borderColor: '#00c6ff',
                    backgroundColor: 'rgba(0, 198, 255, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#00c6ff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#ccc' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#ccc',
                            callback: function (value) { return value + ' ' + currency; }
                        }
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#ccc' }
                    }
                }
            }
        });
    }

    // --- Ügyfelek Kezelése ---
    function renderCustomers() {
        const tbody = document.getElementById('clients-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const customers = dataManager.getCustomers();

        if (customers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Nincsenek még ügyfelek.</td></tr>';
            return;
        }

        customers.forEach(customer => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${customer.name}</td>
                <td>${customer.email}</td>
                <td>${customer.lastVisit || '-'}</td>
                <td><button class="btn" title="Részletek">👁️</button></td>
            `;
            tbody.appendChild(row);
        });
    }

    // Event delegation for Customers table as well (if separate table body)
    const clientsTableBody = document.getElementById('clients-table-body');
    if (clientsTableBody) {
        clientsTableBody.addEventListener('click', function (e) {
            const btn = e.target.closest('button');
            if (btn && btn.title === 'Részletek') {
                const row = btn.closest('tr');
                const name = row.cells[0].textContent;
                const email = row.cells[1].textContent;
                showToast(`Ügyfél neve: ${name}<br>Email: ${email}`, 'info');
            }
        });
    }

    // --- Beállítások Kezelése ---
    function loadSettings() {
        const settings = dataManager.settings;
        const shopNameInput = document.getElementById('setting-shopname');
        const currencyInput = document.getElementById('setting-currency');

        if (shopNameInput) shopNameInput.value = settings.shopName || '';
        if (currencyInput) currencyInput.value = settings.currency || 'Ft';
    }

    function updateUIWithSettings() {
        const settings = dataManager.settings; // Already updated in DataManager or needs reload? 
        // Note: loadSettings uses dataManager.settings. setupSettingsForm updates dataManager.settings.

        // Update Shop Name
        const shopNameElement = document.querySelector('.logo');
        if (shopNameElement) {
            shopNameElement.textContent = settings.shopName || 'StyleMasters';
        }

        // Update Currency everywhere
        if (settings.currency) {
            updateDashboardStats();
            renderChart();
            renderBookings(); // Update table if it shows currency
        }
    }

    function setupSettingsForm() {
        const form = document.getElementById('settings-form');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();

                const newSettings = {
                    shopName: document.getElementById('setting-shopname').value,
                    currency: document.getElementById('setting-currency').value
                };

                dataManager.settings = newSettings;
                dataManager.saveData('settings', newSettings);

                updateUIWithSettings(); // Update UI immediately

                showToast('Beállítások sikeresen mentve!', 'success');
            });
        }
    }

    // --- Gyorsmenü ---
    function setupQuickMenu() {
        const btnAddBooking = document.getElementById('btn-add-booking-quick');
        const btnAddGuest = document.getElementById('btn-add-guest-quick');
        const btnSettings = document.getElementById('btn-settings-quick');

        if (btnAddBooking) {
            btnAddBooking.addEventListener('click', () => {
                // Átirányítás a foglalásokhoz (vagy modal nyitás)
                document.querySelector('a[href="#bookings-section"]').click();
            });
        }

        if (btnSettings) {
            btnSettings.addEventListener('click', () => {
                document.querySelector('a[href="#settings-section"]').click();
            });
        }

        // A "Vendég" gombhoz majd a kliensek nézetet kötjük be
        if (btnAddGuest) {
            btnAddGuest.addEventListener('click', () => {
                document.querySelector('a[href="#clients-section"]').click();
            });
        }
    }

    // --- Product Management Functions ---
    function renderProducts() {
        const container = document.getElementById('product-list');
        if (!container) return;

        const products = dataManager.getProducts();

        if (products.length === 0) {
            container.innerHTML = '<p style="color: #999;">Még nincsenek szolgáltatások.</p>';
            return;
        }

        container.innerHTML = products.map(p => `
            <div class="product-item" data-id="${p.id}" style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 0.5rem;">
                ${p.image ? `<img src="${p.image}" alt="${p.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px;">` : '<div style="width: 60px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">📷</div>'}
                <div style="flex: 1;">
                    <strong>${p.name}</strong><br>
                    <span style="color: var(--accent-color);">${p.price.toLocaleString('hu-HU')} Ft</span>
                </div>
                <button class="btn btn-edit-product" data-id="${p.id}" title="Szerkesztés">✏️</button>
                <button class="btn btn-delete-product" data-id="${p.id}" title="Törlés">🗑️</button>
            </div>
        `).join('');
    }

    function setupProductManagement() {
        const addBtn = document.getElementById('add-product-btn');
        const saveBtn = document.getElementById('save-product-btn');
        const cancelBtn = document.getElementById('cancel-product-btn');
        const productForm = document.getElementById('product-form');
        const imageInput = document.getElementById('product-image');
        const imagePreview = document.getElementById('product-image-preview');
        const productList = document.getElementById('product-list');

        // Show form for adding new product
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                productForm.style.display = 'block';
                document.getElementById('product-id').value = '';
                document.getElementById('product-name').value = '';
                document.getElementById('product-price').value = '';
                document.getElementById('product-image').value = '';
                imagePreview.style.display = 'none';
                imagePreview.src = '';
            });
        }

        // Cancel form
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                productForm.style.display = 'none';
            });
        }

        // Image preview
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        imagePreview.src = event.target.result;
                        imagePreview.style.display = 'block';
                    };
                    reader.readAsDataURL(file);
                } else {
                    imagePreview.style.display = 'none';
                }
            });
        }

        // Save product (add or update)
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const id = document.getElementById('product-id').value;
                const name = document.getElementById('product-name').value.trim();
                const price = parseInt(document.getElementById('product-price').value);

                if (!name || !price) {
                    showToast('Kérlek töltsd ki a nevet és az árat!', 'error');
                    return;
                }

                const product = { name, price, image: imagePreview.src || '' };

                if (id) {
                    // Update existing
                    dataManager.updateProduct(parseInt(id), product);
                    showToast('Szolgáltatás frissítve!', 'success');
                } else {
                    // Add new
                    dataManager.addProduct(product);
                    showToast('Új szolgáltatás hozzáadva!', 'success');
                }

                renderProducts();
                productForm.style.display = 'none';
            });
        }

        // Edit and Delete buttons (event delegation)
        if (productList) {
            productList.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-edit-product');
                const deleteBtn = e.target.closest('.btn-delete-product');

                if (editBtn) {
                    const id = parseInt(editBtn.dataset.id);
                    const product = dataManager.getProducts().find(p => p.id === id);
                    if (product) {
                        productForm.style.display = 'block';
                        document.getElementById('product-id').value = product.id;
                        document.getElementById('product-name').value = product.name;
                        document.getElementById('product-price').value = product.price;
                        if (product.image) {
                            imagePreview.src = product.image;
                            imagePreview.style.display = 'block';
                        } else {
                            imagePreview.style.display = 'none';
                        }
                    }
                }

                if (deleteBtn) {
                    const id = parseInt(deleteBtn.dataset.id);
                    if (confirm('Biztosan törölni szeretnéd ezt a szolgáltatást?')) {
                        dataManager.deleteProduct(id);
                        showToast('Szolgáltatás törölve!', 'success');
                        renderProducts();
                    }
                }
            });
        }

        // Initial render
        renderProducts();
    }


    // Fő függvények meghívása
    // renderBookings(); // Ezt a setupSidebarNavigation hívja meg
    setupEventListeners();
    setupSidebarNavigation();
    setupLogout();
    setupQuickMenu();
    setupProductManagement(); // Product management setup
    setupSettingsForm(); // Beállítások form event listener
    updateUIWithSettings(); // Initial UI update

    // Chart inicializálás (kicsit késleltetve, hogy biztosan látható legyen, bár canvasnál nem feltétel)
    renderChart();

});
