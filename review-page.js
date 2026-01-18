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
    
    const themeIcon = document.getElementById('themeIcon');
    
    // Añadir clase de transición
    if (themeIcon) {
        themeIcon.classList.add('changing');
    }
    
    setTimeout(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
        
        // Remover clase después de cambiar
        setTimeout(() => {
            if (themeIcon) {
                themeIcon.classList.remove('changing');
            }
        }, 50);
    }, 150);
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('themeIcon');
    if (!themeIcon) return;
    
    if (theme === 'light') {
        // Moon icon (activará modo oscuro al hacer click)
        themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="white"/>';
    } else {
        // Sun icon (activará modo claro al hacer click)
        themeIcon.innerHTML = '<circle cx="12" cy="12" r="5" fill="white"/><line x1="12" y1="1" x2="12" y2="3" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="white" stroke-width="2" stroke-linecap="round"/>';
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
                <h3><div class="icon icon-tag icon-small" style="margin-right: 8px; vertical-align: middle; display: inline-block;"></div>Géneros</h3>
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
            additionalHTML += '<h3><div class="icon icon-books icon-small" style="margin-right: 8px; vertical-align: middle; display: inline-block;"></div>Información del Libro</h3>';
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
                additionalHTML += '<h3><div class="icon icon-series icon-small" style="margin-right: 8px; vertical-align: middle; display: inline-block;"></div>Información de la Serie</h3>';
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
            additionalHTML += '<h3><div class="icon icon-movies icon-small" style="margin-right: 8px; vertical-align: middle; display: inline-block;"></div>Información de la Película</h3>';
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
            additionalHTML += '<h3><div class="icon icon-anime icon-small" style="margin-right: 8px; vertical-align: middle; display: inline-block;"></div>Información del Anime</h3>';
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
    const colors = {
        'libro': '#6366f1,#9333ea',
        'serie': '#ec4899,#f43f5e',
        'pelicula': '#10b981,#06b6d4',
        'película': '#10b981,#06b6d4',
        'anime': '#f97316,#dc2626',
        'otro': '#f59e0b,#ef4444'
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
    const [color1, color2] = colorPair.split(',');
    const iconSVG = iconSVGs[type.toLowerCase()] || iconSVGs['otro'];
    
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="400" height="600" fill="url(#grad)"/>
            <g transform="translate(150, 250)" opacity="0.3">
                <svg width="100" height="100" viewBox="0 0 24 24">
                    ${iconSVG}
                </svg>
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
        'libro': '<img src="images/icons/books.svg" alt="" class="type-icon">',
        'serie': '<img src="images/icons/series.svg" alt="" class="type-icon">',
        'pelicula': '<img src="images/icons/movies.svg" alt="" class="type-icon">',
        'película': '<img src="images/icons/movies.svg" alt="" class="type-icon">',
        'anime': '<img src="images/icons/anime.svg" alt="" class="type-icon">',
        'otro': '<img src="images/icons/others.svg" alt="" class="type-icon">'
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
