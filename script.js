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
    const themeIcon = document.querySelector('.theme-icon');
    themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
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
        const emoji = getTypeEmoji(review.tipo);
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
                            <span class="review-type">${emoji} ${review.tipo}</span>
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

function getTypeEmoji(type) {
    const emojis = {
        'libro': '📖',
        'serie': '📺',
        'pelicula': '🎬',
        'película': '🎬',
        'anime': '🎌',
        'otro': '✨'
    };
    return emojis[type.toLowerCase()] || '✨';
}

function generatePlaceholderImage(type) {
    const colors = {
        'libro': 'linear-gradient(135deg, %236366f1, %239333ea)',
        'serie': 'linear-gradient(135deg, %23ec4899, %23f43f5e)',
        'pelicula': 'linear-gradient(135deg, %2310b981, %2306b6d4)',
        'película': 'linear-gradient(135deg, %2310b981, %2306b6d4)',
        'anime': 'linear-gradient(135deg, %23f97316, %23dc2626)',
        'otro': 'linear-gradient(135deg, %23f59e0b, %23ef4444)'
    };
    
    const gradient = colors[type.toLowerCase()] || colors['otro'];
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:rgb(99,102,241);stop-opacity:1" />
                    <stop offset="100%" style="stop-color:rgb(236,72,153);stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="400" height="300" fill="url(%23grad)"/>
            <text x="50%" y="50%" text-anchor="middle" fill="white" font-size="80" font-family="Arial">
                ${getTypeEmoji(type)}
            </text>
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
