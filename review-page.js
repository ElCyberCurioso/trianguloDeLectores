// ============================================
// Review Detail Page Logic
// ============================================

let currentReview = null;
let allReviewsData = [];

// ============================================
// Initialize Page
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initThemeToggle();
    loadReviewDetail();
});

// ============================================
// Theme Management (same as main page)
// ============================================
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
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
    if (!themeIcon) return;
    
    if (theme === 'light') {
        // Moon icon for dark mode
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
        // Sun icon for light mode
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    }
}

// ============================================
// Get Review ID from URL
// ============================================
function getReviewIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// ============================================
// Load Review Detail
// ============================================
async function loadReviewDetail() {
    try {
        const reviewId = getReviewIdFromURL();
        
        if (!reviewId) {
            showError();
            return;
        }
        
        // Load reviews data
        const response = await fetch('reviews.json');
        if (!response.ok) {
            throw new Error('No se pudo cargar el archivo de reviews');
        }
        
        const data = await response.json();
        allReviewsData = data.reviews;
        
        // Find the specific review
        const reviewIndex = parseInt(reviewId);
        currentReview = allReviewsData[reviewIndex];
        
        if (!currentReview) {
            showError();
            return;
        }
        
        // Check if review is published
        if (!isReviewPublished(currentReview)) {
            showError();
            return;
        }
        
        // Display review
        displayReview(currentReview);
        loadRelatedReviews(currentReview);
        initializeGiscus(reviewIndex);
        setupShareButtons();
        
        // Hide loading
        document.getElementById('loading').style.display = 'none';
        document.getElementById('reviewDetail').style.display = 'block';
        
    } catch (error) {
        console.error('Error cargando review:', error);
        showError();
    }
}

// ============================================
// Check if Review is Published
// ============================================
function isReviewPublished(review) {
    const estado = review.estado || 'publicado';
    
    if (estado === 'borrador') {
        return false;
    }
    
    if (estado === 'programado' && review.fecha_publicacion) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const publicationDate = new Date(review.fecha_publicacion);
        publicationDate.setHours(0, 0, 0, 0);
        return publicationDate <= today;
    }
    
    return true;
}

// ============================================
// Display Review
// ============================================
function displayReview(review) {
    // Update page title
    document.title = `${review.titulo} - Triángulo de Lectores`;
    document.getElementById('pageTitle').textContent = `${review.titulo} - Triángulo de Lectores`;
    
    // Set type badge
    const icon = getTypeIcon(review.tipo);
    document.getElementById('reviewType').innerHTML = `${icon} ${review.tipo}`;
    
    // Set title and author
    document.getElementById('reviewTitle').textContent = review.titulo;
    
    const authorElement = document.getElementById('reviewAuthor');
    if (review.autor) {
        authorElement.textContent = `Por ${review.autor}`;
        authorElement.style.display = 'block';
    } else {
        authorElement.style.display = 'none';
    }
    
    // Set rating
    const stars = generateStars(review.calificacion);
    document.getElementById('reviewRating').innerHTML = stars;
    
    // Set date
    document.getElementById('reviewDate').textContent = formatDate(review.fecha);
    
    // Set image
    const imageContainer = document.getElementById('reviewImageContainer');
    const imageElement = document.getElementById('reviewImage');
    
    if (review.imagen && review.imagen !== '') {
        imageElement.src = review.imagen;
        imageElement.alt = review.titulo;
        imageElement.onerror = () => {
            imageElement.src = generatePlaceholderImageURL(review.tipo);
        };
        imageContainer.style.display = 'block';
    } else {
        imageElement.src = generatePlaceholderImageURL(review.tipo);
        imageElement.alt = review.titulo;
        imageContainer.style.display = 'block';
    }
    
    // Set description
    document.getElementById('reviewDescription').textContent = review.descripcion;
    
    // Add additional info section
    displayAdditionalInfo(review);
}

// ============================================
// Display Additional Info
// ============================================
function displayAdditionalInfo(review) {
    const descriptionSection = document.querySelector('.review-detail-content');
    
    let additionalHTML = '';
    
    // Géneros (común para todos)
    if (review.generos && review.generos.length > 0) {
        additionalHTML += `
            <div class="review-metadata">
                <h3><svg class="icon icon-small" style="margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="7" r="1.5"/></svg>Géneros</h3>
                <div class="genres-list">
                    ${review.generos.map(genre => `<span class="genre-tag">${escapeHtml(genre)}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    // Información específica por tipo
    additionalHTML += '<div class="review-metadata">';
    
    switch(review.tipo.toLowerCase()) {
        case 'libro':
            additionalHTML += '<h3><svg class="icon icon-small" style="margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20v-2H6.5a2.5 2.5 0 0 0 0 5H20v-2H6.5a.5.5 0 0 1 0-1z"/><path d="M6.5 2H20v13H6.5a2.5 2.5 0 0 0-2.5 2.5v-13A2.5 2.5 0 0 1 6.5 2z"/></svg>Información del Libro</h3>';
            additionalHTML += '<div class="metadata-grid">';
            
            if (review.paginas) {
                additionalHTML += `
                    <div class="metadata-item">
                        <span class="metadata-label">Páginas:</span>
                        <span class="metadata-value">${review.paginas}</span>
                    </div>
                `;
            }
            
            if (review.editorial) {
                additionalHTML += `
                    <div class="metadata-item">
                        <span class="metadata-label">Editorial:</span>
                        <span class="metadata-value">${escapeHtml(review.editorial)}</span>
                    </div>
                `;
            }
            
            if (review.isbn) {
                additionalHTML += `
                    <div class="metadata-item">
                        <span class="metadata-label">ISBN:</span>
                        <span class="metadata-value">${escapeHtml(review.isbn)}</span>
                    </div>
                `;
            }
            
            additionalHTML += '</div>';
            break;
            
        case 'serie':
            if (review.temporadas && review.temporadas.length > 0) {
                additionalHTML += '<h3><svg class="icon icon-small" style="margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4"/></svg>Información de la Serie</h3>';
                additionalHTML += `<p class="total-seasons">Total de temporadas: <strong>${review.temporadas.length}</strong></p>`;
                additionalHTML += '<div class="seasons-list">';
                
                review.temporadas.forEach(temp => {
                    additionalHTML += `
                        <div class="season-item">
                            <span class="season-number">Temporada ${temp.numero}</span>
                            <span class="season-episodes">${temp.capitulos} capítulos</span>
                        </div>
                    `;
                });
                
                additionalHTML += '</div>';
                
                // Calcular total de capítulos
                const totalEpisodes = review.temporadas.reduce((sum, temp) => sum + temp.capitulos, 0);
                additionalHTML += `<p class="total-episodes">Total: <strong>${totalEpisodes} capítulos</strong></p>`;
            }
            break;
            
        case 'pelicula':
        case 'película':
            additionalHTML += '<h3><svg class="icon icon-small" style="margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.82 2H4.18A2.18 2.18 0 0 0 2 4.18v15.64A2.18 2.18 0 0 0 4.18 22h15.64A2.18 2.18 0 0 0 22 19.82V4.18A2.18 2.18 0 0 0 19.82 2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>Información de la Película</h3>';
            additionalHTML += '<div class="metadata-grid">';
            
            if (review.fecha_estreno) {
                const releaseDate = new Date(review.fecha_estreno);
                const formattedDate = releaseDate.toLocaleDateString('es-ES', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
                additionalHTML += `
                    <div class="metadata-item">
                        <span class="metadata-label">Fecha de estreno:</span>
                        <span class="metadata-value">${formattedDate}</span>
                    </div>
                `;
            }
            
            additionalHTML += '</div>';
            break;
            
        case 'anime':
            additionalHTML += '<h3><svg class="icon icon-small" style="margin-right: 8px; vertical-align: middle;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2a10 10 0 0 1 0 20"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M9 15c0-1.5 1.5-2 3-2s3 .5 3 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>Información del Anime</h3>';
            additionalHTML += '<div class="metadata-grid">';
            
            if (review.temporada_anime) {
                const { año, temporada } = review.temporada_anime;
                additionalHTML += `
                    <div class="metadata-item">
                        <span class="metadata-label">Temporada de emisión:</span>
                        <span class="metadata-value">${temporada} ${año}</span>
                    </div>
                `;
            }
            
            additionalHTML += '</div>';
            break;
    }
    
    additionalHTML += '</div>';
    
    // Insert additional info after description
    descriptionSection.insertAdjacentHTML('beforeend', additionalHTML);
}

// ============================================
// Generate Placeholder Image URL
// ============================================
function generatePlaceholderImageURL(type) {
    const icon = getTypeIcon(type);
    const colors = {
        'libro': '#6366f1,#9333ea',
        'serie': '#ec4899,#f43f5e',
        'pelicula': '#10b981,#06b6d4',
        'película': '#10b981,#06b6d4',
        'anime': '#f97316,#dc2626',
        'otro': '#f59e0b,#ef4444'
    };
    
    const colorPair = colors[type.toLowerCase()] || colors['otro'];
    const [color1, color2] = colorPair.split(',');
    
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="400" height="600" fill="url(#grad)"/>
            <g transform="translate(200, 300) scale(6)">
                ${icon.replace('class="icon"', 'fill="white" stroke="white"')}
            </g>
        </svg>
    `)}`;
}

// ============================================
// Load Related Reviews
// ============================================
function loadRelatedReviews(currentReview) {
    // Filter published reviews of the same type, excluding current
    const related = allReviewsData
        .map((review, index) => ({ ...review, index }))
        .filter(review => 
            review.tipo === currentReview.tipo && 
            review.titulo !== currentReview.titulo &&
            isReviewPublished(review)
        )
        .slice(0, 3); // Show max 3 related reviews
    
    const relatedContainer = document.getElementById('relatedReviews');
    
    if (related.length === 0) {
        relatedContainer.innerHTML = '<p style="color: var(--text-secondary);">No hay reviews relacionadas disponibles.</p>';
        return;
    }
    
    relatedContainer.innerHTML = related.map(review => {
        const stars = generateStars(review.calificacion);
        const imageUrl = review.imagen || generatePlaceholderImageURL(review.tipo);
        
        return `
            <a href="review.html?id=${review.index}" class="related-card">
                <img src="${imageUrl}" alt="${review.titulo}" class="related-card-image"
                     onerror="this.src='${generatePlaceholderImageURL(review.tipo)}'">
                <div class="related-card-content">
                    <h3 class="related-card-title">${escapeHtml(review.titulo)}</h3>
                    <div class="related-card-rating">${stars}</div>
                </div>
            </a>
        `;
    }).join('');
}

// ============================================
// Initialize Giscus Comments
// ============================================
function initializeGiscus(reviewIndex) {
    // NOTA: El usuario necesita configurar estos valores
    // Lee GISCUS_SETUP.md para instrucciones completas
    
    const giscusConfig = {
        repo: 'ElCyberCurioso/trianguloDeLectores', // Usuario debe completar: 'tu-usuario/trianguloDeLectores'
        repoId: 'R_kgDOQ544RA', // Usuario debe obtener de giscus.app
        category: 'Reviews', // Puede personalizarse
        categoryId: 'DIC_kwDOQ544RM4C09Zb', // Usuario debe obtener de giscus.app
        mapping: 'specific', // Usa término específico
        term: `review-${reviewIndex}`, // ID único por review
        reactionsEnabled: '1',
        emitMetadata: '0',
        inputPosition: 'top',
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
        lang: 'es'
    };
    
    // Check if Giscus is configured
    if (!giscusConfig.repo || !giscusConfig.repoId || !giscusConfig.categoryId) {
        console.warn('Giscus no está configurado. Lee GISCUS_SETUP.md para instrucciones.');
        return;
    }
    
    // Create Giscus script
    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.setAttribute('data-repo', giscusConfig.repo);
    script.setAttribute('data-repo-id', giscusConfig.repoId);
    script.setAttribute('data-category', giscusConfig.category);
    script.setAttribute('data-category-id', giscusConfig.categoryId);
    script.setAttribute('data-mapping', giscusConfig.mapping);
    script.setAttribute('data-term', giscusConfig.term);
    script.setAttribute('data-reactions-enabled', giscusConfig.reactionsEnabled);
    script.setAttribute('data-emit-metadata', giscusConfig.emitMetadata);
    script.setAttribute('data-input-position', giscusConfig.inputPosition);
    script.setAttribute('data-theme', giscusConfig.theme);
    script.setAttribute('data-lang', giscusConfig.lang);
    script.setAttribute('crossorigin', 'anonymous');
    script.async = true;
    
    // Replace loading message with Giscus
    const giscusContainer = document.getElementById('giscusContainer');
    giscusContainer.innerHTML = '';
    giscusContainer.appendChild(script);
}

// ============================================
// Setup Share Buttons
// ============================================
function setupShareButtons() {
    const currentURL = window.location.href;
    const title = currentReview.titulo;
    
    // Twitter
    document.getElementById('shareTwitter').addEventListener('click', () => {
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${title} - Triángulo de Lectores`)}&url=${encodeURIComponent(currentURL)}`;
        window.open(url, '_blank');
    });
    
    // Facebook
    document.getElementById('shareFacebook').addEventListener('click', () => {
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(currentURL)}`;
        window.open(url, '_blank');
    });
    
    // Copy Link
    document.getElementById('copyLink').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(currentURL);
            const btn = document.getElementById('copyLink');
            const originalText = btn.textContent;
            btn.textContent = '✅ ¡Copiado!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        } catch (err) {
            alert('Error al copiar el enlace');
        }
    });
}

// ============================================
// Show Error
// ============================================
function showError() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
}

// ============================================
// Helper Functions (from main script.js)
// ============================================
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
