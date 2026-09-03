import type { Bindings } from '../../types/env';
import { ReviewRepository } from '../../db/repos/reviews';
import { CommentRepository, ReportRepository } from '../../db/repos/comments';
import { TaxonomyRepository } from '../../db/repos/taxonomy';
import { UserRepository } from '../../db/repos/users';
import { AuditRepository } from '../../db/repos/audit';
import { MediaRepository } from '../../db/repos/media';
import { WatchlistRepository } from '../../db/repos/watchlist';
import { RecommendationRepository } from '../../db/repos/recommendations';
import { DocumentRepository } from '../../db/repos/documents';
import { LibraryRepository } from '../../db/repos/library';
import { DeviceRepository } from '../../db/repos/devices';
import { SettingsService } from '../lib/settings';
import { Logger } from '../lib/logger';

/**
 * Contenedor por petición. Centraliza el cableado para que los handlers no
 * instancien repositorios a mano y los tests puedan sustituir piezas.
 */
export class Container {
  readonly reviews: ReviewRepository;
  readonly comments: CommentRepository;
  readonly reports: ReportRepository;
  readonly taxonomy: TaxonomyRepository;
  readonly users: UserRepository;
  readonly audit: AuditRepository;
  readonly media: MediaRepository;
  readonly watchlist: WatchlistRepository;
  readonly recommendations: RecommendationRepository;
  /** Biblioteca privada del subdominio `books.`: PDFs y libros en papel. */
  readonly documents: DocumentRepository;
  readonly library: LibraryRepository;
  /** Credenciales de los dispositivos móviles emparejados. */
  readonly devices: DeviceRepository;
  readonly settings: SettingsService;
  readonly log: Logger;

  constructor(readonly env: Bindings, requestId: string) {
    this.reviews = new ReviewRepository(env);
    this.comments = new CommentRepository(env);
    this.reports = new ReportRepository(env);
    this.taxonomy = new TaxonomyRepository(env);
    this.users = new UserRepository(env);
    this.audit = new AuditRepository(env);
    this.media = new MediaRepository(env);
    this.watchlist = new WatchlistRepository(env);
    this.recommendations = new RecommendationRepository(env);
    this.documents = new DocumentRepository(env);
    this.library = new LibraryRepository(env);
    this.devices = new DeviceRepository(env);
    this.settings = new SettingsService(env);
    this.log = new Logger(env, { requestId });
  }
}

/** Se construye uno por petición: el logger lleva el requestId de esa petición. */
export function createContainer(env: Bindings, requestId: string): Container {
  return new Container(env, requestId);
}
