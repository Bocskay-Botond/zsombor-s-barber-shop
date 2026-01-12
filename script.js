document.addEventListener('DOMContentLoaded', () => {
    // --- Global Settings Load ---
    const settings = JSON.parse(localStorage.getItem('settings'));
    if (settings && settings.shopName) {
        const logo = document.querySelector('.logo');
        if (logo) logo.textContent = settings.shopName;
    }

    // --- Görgetés figyelése a fejléc animációhoz ---(Scroll Reveal) ---
    const revealElements = document.querySelectorAll('.reveal-on-scroll');

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            // Amikor az elem a nézetbe ér, hozzáadjuk a 'visible' osztályt
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Opcionális: ne animáljuk újra, ha már megjelent
                // observer.unobserve(entry.target); 
            }
        });
    }, {
        root: null, // a viewport-hoz viszonyítunk
        threshold: 0.1, // az elem 10%-a látható legyen
    });

    // Minden animálandó elem megfigyelése
    revealElements.forEach(element => {
        revealObserver.observe(element);
    });


    // --- Sima görgetés a horgony linkekhez ---
    const navLinks = document.querySelectorAll('nav a[href^="#"], .cta-button[href^="#"]');

    navLinks.forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');

            // Csak akkor próbáljunk görgetni, ha a targetId egy valós elem ID-je lehet
            if (targetId.length > 1) {
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });

    // Toast Helper
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // --- Render Services Dynamically ---
    function renderServices() {
        const container = document.getElementById('services-container');
        if (!container) return;

        const settings = JSON.parse(localStorage.getItem('settings')) || {};
        const products = settings.products || [];

        if (products.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #999;">Jelenleg nincsenek elérhető szolgáltatások.</p>';
            return;
        }

        // Default placeholder image if no image provided
        const defaultImage = 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=500&q=80';

        container.innerHTML = products.map(p => `
            <div class="card" data-service="${p.id}">
                <img src="${p.image || defaultImage}" alt="${p.name}" onerror="this.src='${defaultImage}'">
                <h3>${p.name}</h3>
                <p>Professzionális szolgáltatás prémium minőségben.</p>
                <span class="price">${p.price.toLocaleString('hu-HU')} Ft</span>
            </div>
        `).join('');
    }

    // Render services on page load
    renderServices();

    // --- Foglalási űrlap kezelése (adatmentéssel) ---
    const bookingForm = document.querySelector('.booking-form');

    // Load products dynamically from localStorage
    function loadServiceOptions() {
        const settings = JSON.parse(localStorage.getItem('settings')) || {};
        const products = settings.products || [];
        const serviceSelect = document.getElementById('service');

        // Clear existing options except the first placeholder
        while (serviceSelect.options.length > 1) {
            serviceSelect.remove(1);
        }

        // Add products as options
        products.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = `${p.name} - ${p.price.toLocaleString('hu-HU')} Ft`;
            option.dataset.price = p.price;
            option.dataset.name = p.name;
            serviceSelect.appendChild(option);
        });
    }

    // Load services on page load
    loadServiceOptions();

    bookingForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const serviceSelect = document.getElementById('service');
        const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];

        // Get price and name from selected option's dataset
        const price = parseInt(selectedOption.dataset.price) || 0;
        const serviceName = selectedOption.dataset.name || selectedOption.text;

        // Adatok kinyerése az űrlapból
        const newBooking = {
            id: Date.now(), // Egyedi ID generálása
            guestName: document.getElementById('name').value,
            email: document.getElementById('email').value,
            service: serviceName,
            time: new Date(document.getElementById('date').value).toLocaleString('hu-HU'),
            price: price,
            status: 'Várakozik'
        };

        // Meglévő foglalások betöltése a localStorage-ból
        let bookings = JSON.parse(localStorage.getItem('bookings')) || [];

        // Új foglalás hozzáadása
        bookings.push(newBooking);

        // Visszamentés a localStorage-ba
        localStorage.setItem('bookings', JSON.stringify(bookings));

        // Visszajelzés a felhasználónak
        showToast(`Köszönjük a foglalásod, ${newBooking.guestName}! Hamarosan feldolgozzuk.`, 'success');

        // Űrlap alaphelyzetbe állítása
        bookingForm.reset();
    });

    // --- Új funkció: "Okos" Árlista ---
    function setupPriceCardInteraction() {
        const priceCards = document.querySelectorAll('.price-cards .card');
        const bookingSection = document.getElementById('booking');
        const serviceSelect = document.getElementById('service');

        if (!bookingSection || !serviceSelect) return;

        priceCards.forEach(card => {
            card.addEventListener('click', function () {
                const service = this.dataset.service;
                if (service) {
                    // Szolgáltatás kiválasztása a legördülő menüben
                    serviceSelect.value = service;

                    // Legörgetés a foglalási szekcióhoz
                    bookingSection.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    }

    setupPriceCardInteraction();

});
