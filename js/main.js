/**
 * MindRouter Website - Theme toggle & smooth scrolling
 */
// Copy-to-clipboard for the citation block ([data-copy-target] -> element id)
(function() {
    function copy(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        // Fallback for non-secure contexts (plain http)
        return new Promise(function(resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy') ? resolve() : reject(new Error('copy blocked')); }
            catch (e) { reject(e); }
            finally { ta.remove(); }
        });
    }

    document.querySelectorAll('[data-copy-target]').forEach(function(btn) {
        var original = btn.innerHTML;
        btn.addEventListener('click', function() {
            var src = document.getElementById(btn.getAttribute('data-copy-target'));
            if (!src) return;
            // Collapse the soft-wrapped markup of the rendered citation to one line
            var text = src.tagName === 'CODE'
                ? src.textContent
                : src.textContent.replace(/\s+/g, ' ').trim();
            copy(text)
                .then(function() { btn.innerHTML = '<i class="bi bi-check2"></i> Copied'; })
                .catch(function() { btn.innerHTML = '<i class="bi bi-x-circle"></i> Copy failed'; })
                .then(function() {
                    setTimeout(function() { btn.innerHTML = original; }, 1500);
                });
        });
    });
})();

(function() {
    // Theme toggle
    var btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    var icon = btn.querySelector('i');

    function updateIcon() {
        var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        icon.className = isDark ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
    }

    updateIcon();

    btn.addEventListener('click', function() {
        var current = document.documentElement.getAttribute('data-bs-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-bs-theme', next);
        localStorage.setItem('mr-theme', next);
        updateIcon();
    });

    // Smooth scroll for nav links (skip Bootstrap toggles and the skip link,
    // which need their default behavior). The navbar is shared across the site,
    // so its section links are absolute ("/#features"); on the home page they
    // point at sections of this page and should scroll rather than navigate.
    var onHome = location.pathname === '/' || location.pathname.endsWith('/index.html');
    var anchorLinks = 'a[href^="#"]:not([data-bs-toggle]):not(.skip-link)' +
                      (onHome ? ', a[href^="/#"]:not([data-bs-toggle])' : '');
    document.querySelectorAll(anchorLinks).forEach(function(link) {
        link.addEventListener('click', function(e) {
            var hash = this.getAttribute('href').replace(/^\//, '');
            var target = hash.length > 1 ? document.querySelector(hash) : null;
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Close mobile nav if open
                var navCollapse = document.getElementById('navbarNav');
                if (navCollapse && navCollapse.classList.contains('show')) {
                    var bsCollapse = bootstrap.Collapse.getInstance(navCollapse);
                    if (bsCollapse) bsCollapse.hide();
                }
            }
        });
    });

    // Active nav highlighting on scroll
    var sections = document.querySelectorAll('section[id]');
    if (sections.length > 0) {
        window.addEventListener('scroll', function() {
            var scrollY = window.scrollY + 100;
            sections.forEach(function(section) {
                var top = section.offsetTop;
                var height = section.offsetHeight;
                var id = section.getAttribute('id');
                var link = document.querySelector('.navbar-nav a[href="#' + id + '"], ' +
                                                  '.navbar-nav a[href="/#' + id + '"]');
                if (link) {
                    if (scrollY >= top && scrollY < top + height) {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                }
            });
        });
    }
})();
