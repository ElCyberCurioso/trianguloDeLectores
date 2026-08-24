import type { Comment } from '../db/schema';

export type CommentStatus = Comment['status'];

/**
 * Decide la transición de estado por umbral de reportes.
 *
 * Vive fuera de la clase del Durable Object (y sin importar
 * `cloudflare:workers`) para poder testearla como función pura, que es donde
 * está la regla de negocio que de verdad importa.
 */
export function decideTransition(
  count: number,
  currentStatus: CommentStatus,
  threshold: number,
  autoHideThreshold: number,
): CommentStatus | null {
  if (count >= autoHideThreshold && currentStatus !== 'HIDDEN') return 'HIDDEN';
  if (count >= threshold && (currentStatus === 'APPROVED' || currentStatus === 'PENDING')) return 'REPORTED';
  return null;
}
