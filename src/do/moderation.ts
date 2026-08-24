import { DurableObject } from 'cloudflare:workers';
import { decideTransition, type CommentStatus } from './moderation-rules';

/**
 * Coordinador de moderación: **un DO por comentario**.
 *
 * Resuelve una carrera real: varios reportes simultáneos sobre el mismo
 * comentario harían read-modify-write sobre `report_count` y podrían disparar
 * la transición de estado (y su entrada de auditoría) dos veces. El DO serializa
 * la decisión y devuelve una transición como mucho.
 *
 * La dedupe persistente vive además en D1 (índice único
 * comment_id + reporter_hash); el DO la replica para rechazar duplicados sin
 * tocar la base de datos.
 */

export type { CommentStatus };

export interface ReportInput {
  reporterHash: string;
  /** report_count actual en D1, usado para sembrar el DO la primera vez */
  seedCount: number;
  currentStatus: CommentStatus;
  threshold: number;
  autoHideThreshold: number;
}

export interface ReportDecision {
  duplicate: boolean;
  count: number;
  /** nuevo estado a persistir, o null si no hay transición */
  nextStatus: CommentStatus | null;
}

export class ModerationCoordinator extends DurableObject {
  async report(input: ReportInput): Promise<ReportDecision> {
    const { reporterHash, seedCount, currentStatus, threshold, autoHideThreshold } = input;

    const key = `r:${reporterHash}`;
    if (await this.ctx.storage.get(key)) {
      const count = (await this.ctx.storage.get<number>('count')) ?? seedCount;
      return { duplicate: true, count, nextStatus: null };
    }

    let count = await this.ctx.storage.get<number>('count');
    if (count === undefined) count = seedCount;
    count += 1;

    await this.ctx.storage.put({ [key]: Date.now(), count });

    const nextStatus = decideTransition(count, currentStatus, threshold, autoHideThreshold);
    return { duplicate: false, count, nextStatus };
  }

  /** Un moderador ha resuelto los reportes: se limpia el contador. */
  async clear(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async count(): Promise<number> {
    return (await this.ctx.storage.get<number>('count')) ?? 0;
  }
}
