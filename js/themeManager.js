export class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.init();
        this.setupToggle();
    }

    init() {
        document.documentElement.setAttribute('data-theme', this.theme);
        this.createToggleButton();
    }

    createToggleButton() {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'nav-link theme-toggle';
        toggleBtn.innerHTML = this.theme === 'dark' ? 
            '<i class="ri-sun-line"></i>' : 
            '<i class="ri-moon-line"></i>';
        toggleBtn.id = 'themeToggle';
        
        navLinks.insertBefore(toggleBtn, navLinks.firstChild);
    }

    setupToggle() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#themeToggle')) {
                this.toggleTheme();
            }
        });
    }

    toggleTheme() {
        const newTheme = this.theme === 'light' ? 'dark' : 'light';
        this.theme = newTheme;
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);

        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = newTheme === 'dark' ? 
                '<i class="ri-sun-line"></i>' : 
                '<i class="ri-moon-line"></i>';
        }
    }
}
