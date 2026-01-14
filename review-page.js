	// ============================================
// Review Detail Page Logic
// ============================================

let currentReview = null;
let allReviewsData = [];

// ============================================
// Initialize Page
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadReviewDetail();
});

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
    const emoji = getTypeEmoji(review.tipo);
    document.getElementById('reviewType').innerHTML = `${emoji} ${review.tipo}`;
    
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
}

// ============================================
// Generate Placeholder Image URL
// ============================================
function generatePlaceholderImageURL(type) {
    const emoji = getTypeEmoji(type);
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
            <text x="200" y="320" text-anchor="middle" fill="white" font-size="120" font-family="Arial">
                ${emoji}
            </text>
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
