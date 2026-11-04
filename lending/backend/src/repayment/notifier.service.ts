import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { newId } from '../common/uuid7.entity';
import { NOTIFY, NotificationProvider } from '../integrations/ports';
import { Notification } from './notification.entity';

/** Sends each (loan, kind) message at most once. */
@Injectable()
export class NotifierService {
  private readonly log = new Logger(NotifierService.name);
  constructor(@InjectDataSource() private readonly ds: DataSource, @Inject(NOTIFY) private readonly sms: NotificationProvider) {}

  async once(input: { loanId: string; customerId: string; mobile: string; kind: string; templateKey: string; vars: Record<string, string> }) {
    // Claim the (loanId, kind) slot first; a concurrent run or retry gets nothing back and skips.
    // (Query-builder inserts skip entity hooks, so the UUIDv7 id is set here.)
    const claimed = await this.ds
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values({ loanId: input.loanId, customerId: input.customerId, kind: input.kind, templateKey: input.templateKey, vars: input.vars, id: newId() })
      .orIgnore()
      .returning(['id'])
      .execute();
    const id: string | undefined = claimed.raw?.[0]?.id;
    if (!id) return false;
    try {
      const r = await this.sms.sms(input.mobile, input.templateKey, input.vars);
      await this.ds.getRepository(Notification).update({ id }, { providerRef: r.ref });
      return true;
    } catch (e) {
      // Release the slot so the next run can retry.
      await this.ds.getRepository(Notification).delete({ id });
      this.log.warn(`SMS ${input.kind} for loan ${input.loanId} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
