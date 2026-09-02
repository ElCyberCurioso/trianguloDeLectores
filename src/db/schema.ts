import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Espejo tipado del esquema SQL de `migrations/`.
 * La fuente de verdad del DDL son los ficheros .sql (control total sobre
 * CHECK constraints e índices compuestos); este fichero da tipos + query builder.
 */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailNorm: text('email_norm').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['ADMIN', 'USER'] }).notNull().default('USER'),
    status: text('status', { enum: ['ACTIVE', 'DISABLED'] }).notNull().default('ACTIVE'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: integer('locked_until'),
    lastLoginAt: integer('last_login_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    emailNormIdx: uniqueIndex('idx_users_email_norm').on(t.emailNorm),
    roleIdx: index('idx_users_role').on(t.role),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    csrfSecret: text('csrf_secret').notNull(),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    absoluteExp: integer('absolute_exp').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
    expiresIdx: index('idx_sessions_expires').on(t.expiresAt),
  }),
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('idx_categories_slug').on(t.slug),
    sortIdx: index('idx_categories_sort').on(t.isActive, t.sortOrder),
  }),
);

export const genres = sqliteTable(
  'genres',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ slugIdx: uniqueIndex('idx_genres_slug').on(t.slug) }),
);

export const platforms = sqliteTable(
  'platforms',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['STREAMING', 'STORE', 'LIBRARY', 'AUDIO', 'GAME', 'OTHER'] })
      .notNull()
      .default('OTHER'),
    baseUrl: text('base_url'),
    color: text('color'),
    isActive: integer('is_active').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('idx_platforms_slug').on(t.slug),
    activeIdx: index('idx_platforms_active').on(t.isActive, t.sortOrder),
  }),
);

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    titleEs: text('title_es').notNull(),
    titleOriginal: text('title_original'),
    otherTitles: text('other_titles'),
    contentType: text('content_type', {
      enum: ['BOOK', 'NOVEL', 'MOVIE', 'SERIES', 'ANIME', 'COMIC', 'MANGA', 'GAME', 'OTHER'],
    }).notNull(),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    year: integer('year'),
    creator: text('creator'),
    country: text('country'),
    durationMin: integer('duration_min'),
    episodes: integer('episodes'),
    volumes: integer('volumes'),
    /** 0..10 == estrellas * 2 */
    rating: integer('rating').notNull().default(0),
    summary: text('summary'),
    bodyHtml: text('body_html').notNull().default(''),
    hasSpoilers: integer('has_spoilers').notNull().default(0),
    status: text('status', { enum: ['DRAFT', 'PUBLISHED'] }).notNull().default('DRAFT'),
    commentsMode: text('comments_mode', { enum: ['INHERIT', 'OPEN', 'AUTH', 'CLOSED'] })
      .notNull()
      .default('INHERIT'),
    coverKey: text('cover_key'),
    coverWidth: integer('cover_width'),
    coverHeight: integer('cover_height'),
    coverAlt: text('cover_alt'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    commentCount: integer('comment_count').notNull().default(0),
    publishedAt: integer('published_at'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => ({
    slugIdx: uniqueIndex('idx_reviews_slug').on(t.slug),
    feedIdx: index('idx_reviews_feed').on(t.status, t.deletedAt, t.publishedAt),
    ratingIdx: index('idx_reviews_rating').on(t.status, t.deletedAt, t.rating),
    commentsIdx: index('idx_reviews_comments').on(t.status, t.deletedAt, t.commentCount),
    typeIdx: index('idx_reviews_type').on(t.contentType, t.status, t.deletedAt),
    categoryIdx: index('idx_reviews_category').on(t.categoryId, t.status, t.deletedAt),
    updatedIdx: index('idx_reviews_updated').on(t.updatedAt),
  }),
);

export const reviewGenres = sqliteTable(
  'review_genres',
  {
    reviewId: text('review_id').notNull().references(() => reviews.id, { onDelete: 'cascade' }),
    genreId: text('genre_id').notNull().references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.reviewId, t.genreId] }),
    genreIdx: index('idx_review_genres_genre').on(t.genreId, t.reviewId),
  }),
);

export const reviewPlatforms = sqliteTable(
  'review_platforms',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id').notNull().references(() => reviews.id, { onDelete: 'cascade' }),
    platformId: text('platform_id').notNull().references(() => platforms.id, { onDelete: 'cascade' }),
    url: text('url'),
    availability: text('availability', {
      enum: ['SUBSCRIPTION', 'RENT', 'BUY', 'FREE', 'LIBRARY', 'PHYSICAL', 'OTHER'],
    })
      .notNull()
      .default('OTHER'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('idx_review_platforms_uniq').on(t.reviewId, t.platformId, t.availability),
    reviewIdx: index('idx_review_platforms_review').on(t.reviewId, t.sortOrder),
  }),
);

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id').notNull().references(() => reviews.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    path: text('path').notNull(),
    depth: integer('depth').notNull().default(0),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    authorAlias: text('author_alias').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: ['PENDING', 'APPROVED', 'REJECTED', 'REPORTED', 'HIDDEN'] })
      .notNull()
      .default('PENDING'),
    reportCount: integer('report_count').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
    moderatedBy: text('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    moderatedAt: integer('moderated_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    threadIdx: index('idx_comments_thread').on(t.reviewId, t.path),
    statusIdx: index('idx_comments_status').on(t.status, t.createdAt),
    reportedIdx: index('idx_comments_reported').on(t.reportCount, t.createdAt),
    parentIdx: index('idx_comments_parent').on(t.parentId),
    reviewStatusIdx: index('idx_comments_review_status').on(t.reviewId, t.status, t.createdAt),
  }),
);

export const commentReports = sqliteTable(
  'comment_reports',
  {
    id: text('id').primaryKey(),
    commentId: text('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    reporterHash: text('reporter_hash').notNull(),
    reason: text('reason', {
      enum: ['SPAM', 'INSULTS', 'HARASSMENT', 'SPOILERS', 'OFFENSIVE', 'OTHER'],
    }).notNull(),
    details: text('details'),
    status: text('status', { enum: ['OPEN', 'RESOLVED', 'DISMISSED'] }).notNull().default('OPEN'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    uniq: uniqueIndex('idx_reports_uniq').on(t.commentId, t.reporterHash),
    openIdx: index('idx_reports_open').on(t.status, t.createdAt),
  }),
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: text('metadata'),
    ipHash: text('ip_hash'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    createdIdx: index('idx_audit_created').on(t.createdAt),
    entityIdx: index('idx_audit_entity').on(t.entityType, t.entityId, t.createdAt),
    actorIdx: index('idx_audit_actor').on(t.actorId, t.createdAt),
  }),
);

export const mediaObjects = sqliteTable(
  'media_objects',
  {
    key: text('key').primaryKey(),
    bucketPath: text('bucket_path').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    checksum: text('checksum'),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ createdIdx: index('idx_media_created').on(t.createdAt) }),
);

/**
 * Cola de pendientes del administrador. Más ligera que `reviews` a propósito:
 * aquí todavía no hay opinión, sólo intención de consumir algo.
 */
export const watchlistItems = sqliteTable(
  'watchlist_items',
  {
    id: text('id').primaryKey(),
    titleEs: text('title_es').notNull(),
    titleOriginal: text('title_original'),
    contentType: text('content_type', {
      enum: ['BOOK', 'NOVEL', 'MOVIE', 'SERIES', 'ANIME', 'COMIC', 'MANGA', 'GAME', 'OTHER'],
    }).notNull(),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    year: integer('year'),
    creator: text('creator'),
    note: text('note'),
    sourceUrl: text('source_url'),
    priority: text('priority', { enum: ['LOW', 'MEDIUM', 'HIGH'] }).notNull().default('MEDIUM'),
    status: text('status', { enum: ['PENDING', 'IN_PROGRESS', 'DONE', 'DROPPED'] })
      .notNull()
      .default('PENDING'),
    isPublic: integer('is_public').notNull().default(1),
    coverKey: text('cover_key'),
    coverAlt: text('cover_alt'),
    sortOrder: integer('sort_order').notNull().default(0),
    reviewId: text('review_id').references(() => reviews.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => ({
    queueIdx: index('idx_watchlist_queue').on(t.status, t.priority, t.sortOrder, t.createdAt),
    publicIdx: index('idx_watchlist_public').on(t.isPublic, t.status, t.priority, t.createdAt),
    typeIdx: index('idx_watchlist_type').on(t.contentType, t.status),
    reviewIdx: index('idx_watchlist_review').on(t.reviewId),
  }),
);

/**
 * Recomendaciones del público. Espejo tipado de `0002_recommendations.sql`.
 * Si cambia una, cambia la otra.
 */
export const recommendations = sqliteTable(
  'recommendations',
  {
    id: text('id').primaryKey(),
    titleEs: text('title_es').notNull(),
    contentType: text('content_type', {
      enum: ['BOOK', 'NOVEL', 'MOVIE', 'SERIES', 'ANIME', 'COMIC', 'MANGA', 'GAME', 'OTHER'],
    }).notNull(),
    creator: text('creator'),
    year: integer('year'),
    note: text('note').notNull(),
    sourceUrl: text('source_url'),
    alias: text('alias'),
    status: text('status', { enum: ['PENDING', 'ACCEPTED', 'REJECTED'] }).notNull().default('PENDING'),
    resolution: text('resolution', { enum: ['REVIEW', 'WATCHLIST'] }),
    reviewId: text('review_id').references(() => reviews.id, { onDelete: 'set null' }),
    watchlistId: text('watchlist_id').references(() => watchlistItems.id, { onDelete: 'set null' }),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    bandejaIdx: index('idx_recommendations_bandeja').on(t.status, t.createdAt),
    pendientesIdx: index('idx_recommendations_pendientes').on(t.status),
    origenIdx: index('idx_recommendations_origen').on(t.ipHash, t.createdAt),
  }),
);

/**
 * Biblioteca privada del subdominio `books.`. Espejo tipado de
 * `0003_books.sql`. Si cambia una, cambia la otra.
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    author: text('author'),
    r2Key: text('r2_key').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: text('checksum').notNull(),
    pageCount: integer('page_count'),
    coverKey: text('cover_key'),
    notes: text('notes'),
    addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastReadAt: integer('last_read_at'),
  },
  (t) => ({
    recentIdx: index('idx_documents_recent').on(t.lastReadAt, t.createdAt),
    checksumIdx: uniqueIndex('idx_documents_checksum').on(t.checksum),
  }),
);

export const documentProgress = sqliteTable('document_progress', {
  documentId: text('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  page: integer('page').notNull(),
  scrollPct: integer('scroll_pct').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const documentAnnotations = sqliteTable(
  'document_annotations',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['HIGHLIGHT', 'NOTE'] }).notNull(),
    page: integer('page').notNull(),
    /** JSON con los rectángulos normalizados 0..1. Null en una nota suelta. */
    rects: text('rects'),
    quote: text('quote'),
    body: text('body'),
    color: text('color', { enum: ['YELLOW', 'RED', 'GREEN', 'BLUE'] }).notNull().default('YELLOW'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    docIdx: index('idx_annotations_doc').on(t.documentId, t.page, t.createdAt),
    kindIdx: index('idx_annotations_kind').on(t.documentId, t.kind),
  }),
);

export const libraryBooks = sqliteTable(
  'library_books',
  {
    id: text('id').primaryKey(),
    isbn13: text('isbn13'),
    isbn10: text('isbn10'),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    authors: text('authors'),
    publisher: text('publisher'),
    publishedYear: integer('published_year'),
    pageCount: integer('page_count'),
    language: text('language'),
    coverKey: text('cover_key'),
    location: text('location'),
    status: text('status', { enum: ['OWNED', 'READING', 'READ', 'LENT', 'WISHLIST'] })
      .notNull()
      .default('OWNED'),
    rating: integer('rating'),
    notes: text('notes'),
    source: text('source', { enum: ['MANUAL', 'OPENLIBRARY'] }).notNull().default('MANUAL'),
    addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    isbnIdx: uniqueIndex('idx_library_isbn13').on(t.isbn13),
    titleIdx: index('idx_library_title').on(t.title),
    statusIdx: index('idx_library_status').on(t.status, t.createdAt),
  }),
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Genre = typeof genres.$inferSelect;
export type Platform = typeof platforms.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type ReviewPlatform = typeof reviewPlatforms.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentReport = typeof commentReports.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type MediaObject = typeof mediaObjects.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentProgressRow = typeof documentProgress.$inferSelect;
export type DocumentAnnotation = typeof documentAnnotations.$inferSelect;
export type LibraryBook = typeof libraryBooks.$inferSelect;
