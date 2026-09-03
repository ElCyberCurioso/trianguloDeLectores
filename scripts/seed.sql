-- ============================================================================
-- Seed idempotente (INSERT OR IGNORE). Seguro de re-ejecutar.
-- NO crea usuarios: el administrador se crea con `npm run admin:create`,
-- para que ninguna contraseña viva jamás en el repositorio.
-- ============================================================================

-- ---------------------------------------------------------------- categorías
INSERT OR IGNORE INTO categories (id, slug, name, description, sort_order, is_active, created_at, updated_at) VALUES
  ('11111111-1111-4111-8111-000000000001','libros','Libros','Narrativa, ensayo y no ficción',10,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000002','peliculas','Películas','Largometrajes y documentales',20,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000003','series','Series','Ficción televisiva',30,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000004','anime','Anime','Animación japonesa',40,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000005','manga','Manga','Cómic japonés',50,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000006','comics','Cómics','Cómic europeo y americano',60,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000007','videojuegos','Videojuegos','Juegos de cualquier plataforma',70,1,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('11111111-1111-4111-8111-000000000008','otros','Otros','Todo lo que no encaja en el resto',80,1,strftime('%s','now')*1000,strftime('%s','now')*1000);

-- ------------------------------------------------------------------ géneros
INSERT OR IGNORE INTO genres (id, slug, name, created_at, updated_at) VALUES
  ('22222222-2222-4222-8222-000000000001','ciencia-ficcion','Ciencia ficción',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000002','fantasia','Fantasía',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000003','terror','Terror',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000004','thriller','Thriller',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000005','drama','Drama',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000006','comedia','Comedia',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000007','historico','Histórico',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000008','romance','Romance',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000009','misterio','Misterio',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000010','aventura','Aventura',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000011','slice-of-life','Slice of life',strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('22222222-2222-4222-8222-000000000012','distopia','Distopía',strftime('%s','now')*1000,strftime('%s','now')*1000);

-- -------------------------------------------------------------- plataformas
INSERT OR IGNORE INTO platforms (id, slug, name, kind, base_url, color, is_active, sort_order, created_at, updated_at) VALUES
  ('33333333-3333-4333-8333-000000000001','netflix','Netflix','STREAMING','https://www.netflix.com','#e50914',1,10,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000002','prime-video','Prime Video','STREAMING','https://www.primevideo.com','#00a8e1',1,20,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000003','disney-plus','Disney+','STREAMING','https://www.disneyplus.com','#113ccf',1,30,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000004','max','Max','STREAMING','https://www.max.com','#0046ff',1,40,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000005','crunchyroll','Crunchyroll','STREAMING','https://www.crunchyroll.com','#f47521',1,50,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000006','filmin','Filmin','STREAMING','https://www.filmin.es','#00b1b0',1,60,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000007','movistar-plus','Movistar Plus+','STREAMING','https://ver.movistarplus.es','#0050f0',1,70,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000008','skyshowtime','SkyShowtime','STREAMING','https://www.skyshowtime.com','#3a2a8c',1,80,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000009','amazon','Amazon','STORE','https://www.amazon.es','#ff9900',1,90,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000010','casa-del-libro','Casa del Libro','STORE','https://www.casadellibro.com','#0d4d8c',1,100,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000011','fnac','Fnac','STORE','https://www.fnac.es','#e1a900',1,110,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000012','audible','Audible','AUDIO','https://www.audible.es','#f8991c',1,120,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000013','bibliotecas','Bibliotecas públicas','LIBRARY','https://www.bibliotecaspublicas.es',NULL,1,130,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000014','ebiblio','eBiblio','LIBRARY','https://www.ebiblio.es',NULL,1,140,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000015','libreria','Librería local','LIBRARY',NULL,NULL,1,150,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000016','steam','Steam','GAME','https://store.steampowered.com','#1b2838',1,160,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000017','playstation-store','PlayStation Store','GAME','https://store.playstation.com','#0070d1',1,170,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000018','nintendo-eshop','Nintendo eShop','GAME','https://www.nintendo.es','#e60012',1,180,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000019','xbox','Xbox','GAME','https://www.xbox.com','#107c10',1,190,strftime('%s','now')*1000,strftime('%s','now')*1000),
  ('33333333-3333-4333-8333-000000000020','gog','GOG','GAME','https://www.gog.com','#86328a',1,200,strftime('%s','now')*1000,strftime('%s','now')*1000);

-- ---------------------------------------------------------------- ajustes
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('comments.mode','"OPEN"',strftime('%s','now')*1000),
  ('comments.require_approval','true',strftime('%s','now')*1000),
  ('comments.max_depth','4',strftime('%s','now')*1000),
  ('comments.min_length','2',strftime('%s','now')*1000),
  ('comments.max_length','2000',strftime('%s','now')*1000),
  ('comments.alias_max_length','40',strftime('%s','now')*1000),
  ('moderation.report_threshold','3',strftime('%s','now')*1000),
  ('moderation.auto_hide_threshold','10',strftime('%s','now')*1000),
  ('security.turnstile_login','true',strftime('%s','now')*1000),
  ('security.turnstile_comments','true',strftime('%s','now')*1000),
  ('security.turnstile_reports','true',strftime('%s','now')*1000),
  ('site.tagline','"Reseñas de libros, cine, series, anime, cómic y videojuegos"',strftime('%s','now')*1000),
  ('site.description','"Reseñas honestas de libros, novelas, películas, series, anime, cómics, manga y videojuegos. Con puntuación de 0 a 5 estrellas y dónde encontrar cada obra."',strftime('%s','now')*1000),
  ('privacy.audit_retention_days','365',strftime('%s','now')*1000);

-- ------------------------------------------------- reseñas de ejemplo (dev)
INSERT OR IGNORE INTO reviews
  (id, slug, title_es, title_original, other_titles, content_type, category_id, year, creator,
   country, duration_min, episodes, volumes, rating, rating_half, summary, body_html, has_spoilers, status,
   comments_mode, cover_key, cover_alt, seo_title, seo_description, comment_count, published_at,
   created_at, updated_at)
VALUES
  ('44444444-4444-4444-8444-000000000001','dune','Dune','Dune','["Dune: Parte Uno"]','MOVIE',
   '11111111-1111-4111-8111-000000000002',2021,'Denis Villeneuve','Estados Unidos',155,NULL,NULL,10,19,
   'Una adaptación monumental que por fin entiende que Arrakis es un personaje más.',
   '<p>Villeneuve resuelve lo que parecía irresoluble: convertir la densidad política de Herbert en imágenes que se sostienen solas.</p><h2>Lo mejor</h2><ul><li>El diseño de sonido.</li><li>El ritmo pausado, que respeta al espectador.</li></ul><p>Un aviso: <span class="spoiler">el final deja la historia a medias, porque es literalmente media novela</span>.</p>',
   0,'PUBLISHED','INHERIT',NULL,NULL,NULL,NULL,0,
   strftime('%s','now')*1000 - 86400000*20, strftime('%s','now')*1000 - 86400000*20, strftime('%s','now')*1000 - 86400000*20),

  ('44444444-4444-4444-8444-000000000002','frieren','Frieren: Beyond Journey''s End','Sousou no Frieren',NULL,'ANIME',
   '11111111-1111-4111-8111-000000000004',2023,'Keiichirou Saitou','Japón',NULL,28,NULL,10,20,
   'La fantasía más melancólica y luminosa de los últimos años.',
   '<p>Frieren invierte el esquema del shonen de aventuras: empieza donde otras acaban y convierte el duelo en motor narrativo.</p><blockquote>El tiempo de un elfo no es el tiempo de una persona.</blockquote><p>Su mayor virtud es la paciencia.</p>',
   0,'PUBLISHED','INHERIT',NULL,NULL,NULL,NULL,0,
   strftime('%s','now')*1000 - 86400000*10, strftime('%s','now')*1000 - 86400000*10, strftime('%s','now')*1000 - 86400000*10),

  ('44444444-4444-4444-8444-000000000003','la-carretera','La carretera','The Road',NULL,'BOOK',
   '11111111-1111-4111-8111-000000000001',2006,'Cormac McCarthy','Estados Unidos',NULL,NULL,NULL,9,18,
   'Postapocalipsis despojado de todo adorno. Duele y no se olvida.',
   '<p>McCarthy elimina comillas, capítulos y casi toda la puntuación, y en ese vacío cabe el mundo entero.</p><p>Es un libro corto que se lee despacio.</p>',
   1,'PUBLISHED','INHERIT',NULL,NULL,NULL,NULL,0,
   strftime('%s','now')*1000 - 86400000*3, strftime('%s','now')*1000 - 86400000*3, strftime('%s','now')*1000 - 86400000*3),

  ('44444444-4444-4444-8444-000000000004','borrador-ejemplo','Reseña en borrador',NULL,NULL,'GAME',
   '11111111-1111-4111-8111-000000000007',2024,'Estudio de ejemplo','España',NULL,NULL,NULL,0,0,
   NULL,'<p>Pendiente de escribir.</p>',0,'DRAFT','INHERIT',NULL,NULL,NULL,NULL,0,NULL,
   strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO review_genres (review_id, genre_id) VALUES
  ('44444444-4444-4444-8444-000000000001','22222222-2222-4222-8222-000000000001'),
  ('44444444-4444-4444-8444-000000000001','22222222-2222-4222-8222-000000000010'),
  ('44444444-4444-4444-8444-000000000002','22222222-2222-4222-8222-000000000002'),
  ('44444444-4444-4444-8444-000000000002','22222222-2222-4222-8222-000000000011'),
  ('44444444-4444-4444-8444-000000000003','22222222-2222-4222-8222-000000000012'),
  ('44444444-4444-4444-8444-000000000003','22222222-2222-4222-8222-000000000005');

INSERT OR IGNORE INTO review_platforms (id, review_id, platform_id, url, availability, note, sort_order, created_at) VALUES
  ('55555555-5555-4555-8555-000000000001','44444444-4444-4444-8444-000000000001','33333333-3333-4333-8333-000000000004','https://www.max.com','SUBSCRIPTION',NULL,0,strftime('%s','now')*1000),
  ('55555555-5555-4555-8555-000000000002','44444444-4444-4444-8444-000000000001','33333333-3333-4333-8333-000000000002','https://www.primevideo.com','RENT',NULL,1,strftime('%s','now')*1000),
  ('55555555-5555-4555-8555-000000000003','44444444-4444-4444-8444-000000000002','33333333-3333-4333-8333-000000000005','https://www.crunchyroll.com','SUBSCRIPTION',NULL,0,strftime('%s','now')*1000),
  ('55555555-5555-4555-8555-000000000004','44444444-4444-4444-8444-000000000003','33333333-3333-4333-8333-000000000013',NULL,'LIBRARY','Disponible en la mayoría de redes municipales',0,strftime('%s','now')*1000),
  ('55555555-5555-4555-8555-000000000005','44444444-4444-4444-8444-000000000003','33333333-3333-4333-8333-000000000010','https://www.casadellibro.com','BUY',NULL,1,strftime('%s','now')*1000);

-- Comentario aprobado de ejemplo, con una respuesta.
INSERT OR IGNORE INTO comments
  (id, review_id, parent_id, path, depth, user_id, author_alias, body, status, report_count,
   is_deleted, reply_count, created_at, updated_at)
VALUES
  ('66666666-6666-4666-8666-000000000001','44444444-4444-4444-8444-000000000001',NULL,'000000000aaaaaaaa/',0,NULL,
   'Ana','Me pareció larguísima pero no sobra un plano. La vi dos veces.','APPROVED',0,0,1,
   strftime('%s','now')*1000 - 86400000*2, strftime('%s','now')*1000 - 86400000*2),
  ('66666666-6666-4666-8666-000000000002','44444444-4444-4444-8444-000000000001','66666666-6666-4666-8666-000000000001','000000000aaaaaaaa/000000000bbbbbbbb/',1,NULL,
   'Marcos','Coincido. La segunda parte mejora el ritmo.','APPROVED',0,0,0,
   strftime('%s','now')*1000 - 86400000, strftime('%s','now')*1000 - 86400000);

UPDATE reviews SET comment_count = (
  SELECT COUNT(*) FROM comments c WHERE c.review_id = reviews.id AND c.status = 'APPROVED' AND c.is_deleted = 0
);

-- --------------------------------------------- pendientes de ejemplo (dev)
INSERT OR IGNORE INTO watchlist_items
  (id, title_es, title_original, content_type, category_id, year, creator, note, source_url,
   priority, status, is_public, sort_order, created_at, updated_at)
VALUES
  ('77777777-7777-4777-8777-000000000001','Los detectives salvajes',NULL,'BOOK',
   '11111111-1111-4111-8111-000000000001',1998,'Roberto Bolaño',
   'Lleva dos años en la estantería mirándome mal. Este invierno cae.',NULL,
   'HIGH','IN_PROGRESS',1,0,strftime('%s','now')*1000 - 86400000*14, strftime('%s','now')*1000 - 86400000*2),

  ('77777777-7777-4777-8777-000000000002','Vinland Saga','Vinland Saga','MANGA',
   '11111111-1111-4111-8111-000000000005',2005,'Makoto Yukimura',
   'Me lo recomiendan cada vez que digo que el manga histórico me aburre.',NULL,
   'HIGH','PENDING',1,0,strftime('%s','now')*1000 - 86400000*9, strftime('%s','now')*1000 - 86400000*9),

  ('77777777-7777-4777-8777-000000000003','Disco Elysium',NULL,'GAME',
   '11111111-1111-4111-8111-000000000007',2019,'ZA/UM',
   'Dicen que es más novela que juego. Habrá que comprobarlo con tiempo por delante.',
   'https://store.steampowered.com','MEDIUM','PENDING',1,0,
   strftime('%s','now')*1000 - 86400000*7, strftime('%s','now')*1000 - 86400000*7),

  ('77777777-7777-4777-8777-000000000004','Perfect Days',NULL,'MOVIE',
   '11111111-1111-4111-8111-000000000002',2023,'Wim Wenders',
   'Para una tarde tranquila.',NULL,'MEDIUM','PENDING',1,0,
   strftime('%s','now')*1000 - 86400000*4, strftime('%s','now')*1000 - 86400000*4),

  ('77777777-7777-4777-8777-000000000005','Nota privada de prueba',NULL,'OTHER',
   NULL,NULL,NULL,'Este no debe aparecer en la página pública.',NULL,
   'LOW','PENDING',0,0,strftime('%s','now')*1000, strftime('%s','now')*1000);
