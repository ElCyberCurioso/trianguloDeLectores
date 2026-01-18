// ============================================
// Estado Global
// ============================================
let allReviews = [];
let currentFilter = 'all';
let currentSearchTerm = '';
let currentGenre = 'all';

// ============================================
// Inicialización
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initEventListeners();
    loadReviews();
});

// ============================================
// Theme Management
// ============================================
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    const themeIcon = document.getElementById('themeIcon');
    
    // Añadir clase de transición
    themeIcon.classList.add('changing');
    
    setTimeout(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
        
        // Remover clase después de cambiar
        setTimeout(() => {
            themeIcon.classList.remove('changing');
        }, 50);
    }, 150);
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('themeIcon');
    if (theme === 'light') {
        // Moon icon (activará modo oscuro al hacer click)
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="white"/>';
    } else {
        // Sun icon (activará modo claro al hacer click)
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5" fill="white"/><line x1="12" y1="1" x2="12" y2="3" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="white" stroke-width="2" stroke-linecap="round"/>';
    }
}

// ============================================
// Event Listeners
// ============================================
function initEventListeners() {
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.addEventListener('click', toggleTheme);
    
    // Filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update active state
            filterButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Update filter
            currentFilter = e.target.getAttribute('data-filter');
            
            // Reset genre filter when changing category
            currentGenre = 'all';
            
            // Update genre filters
            updateGenreFilters();
            
            filterAndRenderReviews();
        });
    });
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value.toLowerCase();
        filterAndRenderReviews();
    });
}

// ============================================
// Load Reviews
// ============================================
async function loadReviews() {
    try {
        const response = await fetch('reviews.json');
        if (!response.ok) {
            throw new Error('No se pudo cargar el archivo de reviews');
        }
        
        const data = await response.json();
        
        // Store ALL reviews (including drafts and scheduled) for index lookup
        // But filter for display
        const allReviewsData = data.reviews;
        allReviews = filterPublishedReviews(allReviewsData);
        
        // Hide loading
        document.getElementById('loading').style.display = 'none';
        
        // Render reviews
        filterAndRenderReviews();
    } catch (error) {
        console.error('Error cargando reviews:', error);
        document.getElementById('loading').innerHTML = `
            <p style="color: var(--text-secondary);">
                ❌ Error al cargar las reviews. Asegúrate de que el archivo reviews.json existe.
            </p>
        `;
    }
}

// ============================================
// Filter Published Reviews
// ============================================
function filterPublishedReviews(reviews) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to midnight for accurate date comparison
    
    return reviews
        .map((review, originalIndex) => ({ ...review, originalIndex })) // Guardar índice original
        .filter(review => {
            // If no estado field, assume published (backward compatibility)
            const estado = review.estado || 'publicado';
            
            // Hide drafts
            if (estado === 'borrador') {
                return false;
            }
            
            // Show published reviews immediately
            if (estado === 'publicado') {
                return true;
            }
            
            // For scheduled reviews, check publication date
            if (estado === 'programado' && review.fecha_publicacion) {
                const publicationDate = new Date(review.fecha_publicacion);
                publicationDate.setHours(0, 0, 0, 0);
                return publicationDate <= today;
            }
            
            // Default: show the review
            return true;
        });
}

// ============================================
// Update Genre Filters
// ============================================
function updateGenreFilters() {
    const genreContainer = document.getElementById('genreFilterContainer');
    const genreFilters = document.getElementById('genreFilters');
    
    // Hide genre filter for "all" and "otro"
    if (currentFilter === 'all' || currentFilter === 'otro') {
        genreContainer.style.display = 'none';
        return;
    }
    
    // Get unique genres for current category
    const genres = new Set();
    allReviews
        .filter(review => review.tipo.toLowerCase() === currentFilter.toLowerCase())
        .forEach(review => {
            if (review.generos && Array.isArray(review.generos)) {
                review.generos.forEach(genre => genres.add(genre));
            }
        });
    
    // If no genres, hide filter
    if (genres.size === 0) {
        genreContainer.style.display = 'none';
        return;
    }
    
    // Show and populate genre filters
    genreContainer.style.display = 'block';
    
    // Create genre buttons
    let genreHTML = '<button class="genre-filter-btn active" data-genre="all">Todos</button>';
    
    Array.from(genres).sort().forEach(genre => {
        genreHTML += `<button class="genre-filter-btn" data-genre="${escapeHtml(genre)}">${escapeHtml(genre)}</button>`;
    });
    
    genreFilters.innerHTML = genreHTML;
    
    // Add event listeners to genre buttons
    document.querySelectorAll('.genre-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update active state
            document.querySelectorAll('.genre-filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Update genre filter
            currentGenre = e.target.getAttribute('data-genre');
            filterAndRenderReviews();
        });
    });
}

// ============================================
// Filter and Render Reviews
// ============================================
function filterAndRenderReviews() {
    let filteredReviews = allReviews;
    
    // Apply category filter
    if (currentFilter !== 'all') {
        filteredReviews = filteredReviews.filter(review => 
            review.tipo.toLowerCase() === currentFilter.toLowerCase()
        );
    }
    
    // Apply genre filter
    if (currentGenre !== 'all' && currentFilter !== 'all' && currentFilter !== 'otro') {
        filteredReviews = filteredReviews.filter(review => {
            if (!review.generos || !Array.isArray(review.generos)) {
                return false;
            }
            return review.generos.includes(currentGenre);
        });
    }
    
    // Apply search filter
    if (currentSearchTerm) {
        filteredReviews = filteredReviews.filter(review => {
            const searchableText = `
                ${review.titulo} 
                ${review.autor || ''} 
                ${review.descripcion}
            `.toLowerCase();
            
            return searchableText.includes(currentSearchTerm);
        });
    }
    
    renderReviews(filteredReviews);
}

// ============================================
// Render Reviews
// ============================================
function renderReviews(reviews) {
    const grid = document.getElementById('reviewsGrid');
    const noResults = document.getElementById('noResults');
    
    if (reviews.length === 0) {
        grid.innerHTML = '';
        noResults.style.display = 'block';
        return;
    }
    
    noResults.style.display = 'none';
    
    grid.innerHTML = reviews.map((review, index) => {
        const stars = generateStars(review.calificacion);
        const icon = getTypeIcon(review.tipo);
        const imageUrl = review.imagen || generatePlaceholderImage(review.tipo);
        
        // Use the original index saved during filtering
        const reviewIndex = review.originalIndex !== undefined ? review.originalIndex : index;
        
        return `
            <a href="review.html?id=${reviewIndex}" style="text-decoration: none; color: inherit; display: block;">
                <article class="review-card" style="animation-delay: ${index * 0.05}s">
                    <img src="${imageUrl}" alt="${review.titulo}" class="review-image" 
                         onerror="this.src='${generatePlaceholderImage(review.tipo)}'">
                    <div class="review-content">
                        <div class="review-header">
                            <span class="review-type">${icon} ${review.tipo}</span>
                            <h2 class="review-title">${escapeHtml(review.titulo)}</h2>
                            ${review.autor ? `<p class="review-author">Por ${escapeHtml(review.autor)}</p>` : ''}
                        </div>
                        <div class="review-rating" aria-label="Calificación: ${review.calificacion} de 5 estrellas">
                            ${stars}
                        </div>
                        <p class="review-description">${escapeHtml(review.descripcion.substring(0, 150))}${review.descripcion.length > 150 ? '...' : ''}</p>
                        <p class="review-date">${formatDate(review.fecha)}</p>
                    </div>
                </article>
            </a>
        `;
    }).join('');
}

// ============================================
// Helper Functions
// ============================================
function generateStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.25 && rating % 1 < 0.75;
    const emptyStars = 5 - Math.ceil(rating);
    
    let starsHTML = '<div class="stars-container">';
    starsHTML += '<div class="stars">';
    
    // SVG definition for half star
    starsHTML += `
        <svg style="position: absolute; width: 0; height: 0;">
            <defs>
                <linearGradient id="half-fill">
                    <stop offset="50%" stop-color="#fbbf24" />
                    <stop offset="50%" stop-color="var(--border-color)" />
                </linearGradient>
            </defs>
        </svg>
    `;
    
    // Full stars
    for (let i = 0; i < fullStars; i++) {
        starsHTML += `
            <span class="star filled">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
            </span>
        `;
    }
    
    // Half star
    if (hasHalfStar) {
        starsHTML += `
            <span class="star half">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
            </span>
        `;
    }
    
    // Empty stars
    const emptyCount = hasHalfStar ? emptyStars - 1 : emptyStars;
    for (let i = 0; i < emptyCount; i++) {
        starsHTML += `
            <span class="star">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
            </span>
        `;
    }
    
    starsHTML += '</div>';
    starsHTML += `<span class="rating-number">${rating.toFixed(1)}</span>`;
    starsHTML += '</div>';
    
    return starsHTML;
}

function getTypeIcon(type) {
    const icons = {
        'libro': '<img src="images/icons/books.svg" alt="" class="type-icon">',
        'serie': '<img src="images/icons/series.svg" alt="" class="type-icon">',
        'pelicula': '<img src="images/icons/movies.svg" alt="" class="type-icon">',
        'película': '<img src="images/icons/movies.svg" alt="" class="type-icon">',
        'anime': '<img src="images/icons/anime.svg" alt="" class="type-icon">',
        'otro': '<img src="images/icons/others.svg" alt="" class="type-icon">'
    };
    return icons[type.toLowerCase()] || icons['otro'];
}

function generatePlaceholderImage(type) {
    const colors = {
        'libro': { start: 'rgb(99,102,241)', end: 'rgb(147,51,234)' },
        'serie': { start: 'rgb(236,72,153)', end: 'rgb(244,63,94)' },
        'pelicula': { start: 'rgb(16,185,129)', end: 'rgb(6,182,212)' },
        'película': { start: 'rgb(16,185,129)', end: 'rgb(6,182,212)' },
        'anime': { start: 'rgb(249,115,22)', end: 'rgb(220,38,38)' },
        'otro': { start: 'rgb(245,158,11)', end: 'rgb(239,68,68)' }
    };
    
    const iconSVGs = {
        'libro': '<path d="M12 10.4V20M12 10.4C12 8.15979 12 7.03969 11.564 6.18404C11.1805 5.43139 10.5686 4.81947 9.81596 4.43597C8.96031 4 7.84021 4 5.6 4H4.6C4.03995 4 3.75992 4 3.54601 4.10899C3.35785 4.20487 3.20487 4.35785 3.10899 4.54601C3 4.75992 3 5.03995 3 5.6V16.4C3 16.9601 3 17.2401 3.10899 17.454C3.20487 17.6422 3.35785 17.7951 3.54601 17.891C3.75992 18 4.03995 18 4.6 18H7.54668C8.08687 18 8.35696 18 8.61814 18.0466C8.84995 18.0879 9.0761 18.1563 9.29191 18.2506C9.53504 18.3567 9.75977 18.5065 10.2092 18.8062L12 20M12 10.4C12 8.15979 12 7.03969 12.436 6.18404C12.8195 5.43139 13.4314 4.81947 14.184 4.43597C15.0397 4 16.1598 4 18.4 4H19.4C19.9601 4 20.2401 4 20.454 4.10899C20.6422 4.20487 20.7951 4.35785 20.891 4.54601C21 4.75992 21 5.03995 21 5.6V16.4C21 16.9601 21 17.2401 20.891 17.454C20.7951 17.6422 20.6422 17.7951 20.454 17.891C20.2401 18 19.9601 18 19.4 18H16.4533C15.9131 18 15.643 18 15.3819 18.0466C15.15 18.0879 14.9239 18.1563 14.7081 18.2506C14.465 18.3567 14.2402 18.5065 13.7908 18.8062L12 20" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
        'serie': '<rect x="2" y="4" width="20" height="14" rx="2" stroke="white" stroke-width="1.5" fill="none"/><path d="M8 22h8M12 18v4" stroke="white" stroke-width="1.5"/>',
        'pelicula': '<path d="M19.7286477,3.91709009 L19.7796475,4.07673953 L20.3309222,5.99926292 C20.4355805,6.36424991 20.2508505,6.74366136 19.9126449,6.89230405 L19.8167039,6.92693721 L9.08979429,10.0020329 L20.2488588,10.0029698 C20.6285546,10.0029698 20.9423498,10.2851237 20.9920122,10.6511993 L20.9988588,10.7529698 L20.9988588,19.2509821 C20.9988588,20.713514 19.8571542,21.9093864 18.4163811,21.9959633 L18.2488588,22.0009821 L5.75,22.0009821 C4.28746816,22.0009821 3.09159572,20.8592775 3.00501879,19.4185045 L3,19.2509821 L2.99979429,10.8590329 L2.47803395,9.03789737 C2.07490554,7.63202154 2.84275532,6.16777873 4.20385145,5.68742476 L4.36350088,5.63642498 L16.3781751,2.19127259 C17.7840509,1.78814418 19.2482937,2.55599396 19.7286477,3.91709009 Z M19.498,11.502 L4.5,11.502 L4.5,19.2509821 C4.5,19.8550436 4.92847749,20.3590287 5.4980814,20.4755866 L5.62219476,20.4945285 L5.75,20.5009821 L18.2488588,20.5009821 C18.8960675,20.5009821 19.4283927,20.0091075 19.4924052,19.3787874 L19.4988588,19.2509821 L19.498,11.502 Z M6.27268011,6.6494258 L4.77695691,7.07831752 C4.15481999,7.25671241 3.7786565,7.8762725 3.89085867,8.49982068 L3.91988247,8.62445396 L4.26421826,9.82529556 L4.55930489,9.74043653 L6.27268011,6.6494258 Z M11.029003,5.28557216 L8.31151617,6.06479896 L6.59814094,9.15580969 L9.31562776,8.37658289 L11.029003,5.28557216 Z M15.7862871,3.92144289 L13.0688003,4.70066969 L11.3554251,7.79168042 L14.0719506,7.01272925 L15.7862871,3.92144289 Z M17.6334765,3.68788446 L16.1127092,6.42755115 L18.6812212,5.6912865 L18.3377549,4.49019556 C18.2305941,4.11648136 17.96425,3.83153666 17.6334765,3.68788446 Z" fill="white"/>',
        'película': '<path d="M19.7286477,3.91709009 L19.7796475,4.07673953 L20.3309222,5.99926292 C20.4355805,6.36424991 20.2508505,6.74366136 19.9126449,6.89230405 L19.8167039,6.92693721 L9.08979429,10.0020329 L20.2488588,10.0029698 C20.6285546,10.0029698 20.9423498,10.2851237 20.9920122,10.6511993 L20.9988588,10.7529698 L20.9988588,19.2509821 C20.9988588,20.713514 19.8571542,21.9093864 18.4163811,21.9959633 L18.2488588,22.0009821 L5.75,22.0009821 C4.28746816,22.0009821 3.09159572,20.8592775 3.00501879,19.4185045 L3,19.2509821 L2.99979429,10.8590329 L2.47803395,9.03789737 C2.07490554,7.63202154 2.84275532,6.16777873 4.20385145,5.68742476 L4.36350088,5.63642498 L16.3781751,2.19127259 C17.7840509,1.78814418 19.2482937,2.55599396 19.7286477,3.91709009 Z M19.498,11.502 L4.5,11.502 L4.5,19.2509821 C4.5,19.8550436 4.92847749,20.3590287 5.4980814,20.4755866 L5.62219476,20.4945285 L5.75,20.5009821 L18.2488588,20.5009821 C18.8960675,20.5009821 19.4283927,20.0091075 19.4924052,19.3787874 L19.4988588,19.2509821 L19.498,11.502 Z M6.27268011,6.6494258 L4.77695691,7.07831752 C4.15481999,7.25671241 3.7786565,7.8762725 3.89085867,8.49982068 L3.91988247,8.62445396 L4.26421826,9.82529556 L4.55930489,9.74043653 L6.27268011,6.6494258 Z M11.029003,5.28557216 L8.31151617,6.06479896 L6.59814094,9.15580969 L9.31562776,8.37658289 L11.029003,5.28557216 Z M15.7862871,3.92144289 L13.0688003,4.70066969 L11.3554251,7.79168042 L14.0719506,7.01272925 L15.7862871,3.92144289 Z M17.6334765,3.68788446 L16.1127092,6.42755115 L18.6812212,5.6912865 L18.3377549,4.49019556 C18.2305941,4.11648136 17.96425,3.83153666 17.6334765,3.68788446 Z" fill="white"/>',
        'anime': '<rect x="3" y="5" width="18" height="13" rx="3" stroke="white" stroke-width="1.2" fill="none"/><line x1="8.5" y1="2" x2="10.2" y2="5" stroke="white" stroke-width="1.2"/><line x1="6.6" y1="11.8" x2="10" y2="10.5" stroke="white" stroke-width="1.2"/><line x1="15.3" y1="2" x2="13.8" y2="5" stroke="white" stroke-width="1.2"/><line x1="17.4" y1="11.8" x2="14" y2="10.5" stroke="white" stroke-width="1.2"/><path d="M14.5,13c-.3,.7-.6,1.3-1.3,1.3-.5,0-.8-.2-1.3-.9-.4,.7-.7,.9-1.3,.9-.7,0-1-.5-1.3-1.3" stroke="white" stroke-width="1.2" fill="none"/><path d="M13,19v1s4.3,.1,4.3,2.8H6.7c0-2.6,4.3-2.8,4.3-2.8v-1" stroke="white" stroke-width="1.2" fill="none"/>',
        'otro': '<circle cx="12" cy="12" r="2" fill="white"/><circle cx="6" cy="12" r="2" fill="white"/><circle cx="18" cy="12" r="2" fill="white"/>'
    };
    
    const colorPair = colors[type.toLowerCase()] || colors['otro'];
    const iconSVG = iconSVGs[type.toLowerCase()] || iconSVGs['otro'];
    
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${colorPair.start};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${colorPair.end};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="400" height="300" fill="url(#grad)"/>
            <g transform="translate(150, 100)" opacity="0.3">
                <svg width="100" height="100" viewBox="0 0 24 24">
                    ${iconSVG}
                </svg>
            </g>
        </svg>
    `)}`;
}

function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', options);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Smooth Scroll (opcional)
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});
