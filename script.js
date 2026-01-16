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
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('themeIcon');
    if (theme === 'light') {
        // Moon icon for dark mode
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
        // Sun icon for light mode
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
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
        'libro': '<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20v-2H6.5a2.5 2.5 0 0 0 0 5H20v-2H6.5a.5.5 0 0 1 0-1z"/><path d="M6.5 2H20v13H6.5a2.5 2.5 0 0 0-2.5 2.5v-13A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        'serie': '<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4"/></svg>',
        'pelicula': '<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.82 2H4.18A2.18 2.18 0 0 0 2 4.18v15.64A2.18 2.18 0 0 0 4.18 22h15.64A2.18 2.18 0 0 0 22 19.82V4.18A2.18 2.18 0 0 0 19.82 2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>',
        'película': '<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.82 2H4.18A2.18 2.18 0 0 0 2 4.18v15.64A2.18 2.18 0 0 0 4.18 22h15.64A2.18 2.18 0 0 0 22 19.82V4.18A2.18 2.18 0 0 0 19.82 2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>',
        'anime': '<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2a10 10 0 0 1 0 20"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M9 15c0-1.5 1.5-2 3-2s3 .5 3 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
        'otro': '<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/></svg>'
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
    
    const colorPair = colors[type.toLowerCase()] || colors['otro'];
    const icon = getTypeIcon(type);
    
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${colorPair.start};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${colorPair.end};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="400" height="300" fill="url(#grad)"/>
            <g transform="translate(200, 150) scale(4)">
                ${icon.replace('class="icon"', 'fill="white" stroke="white"')}
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
