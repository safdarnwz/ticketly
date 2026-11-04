import { Column, Entity, Index } from 'typeorm';
import { Uuid7Entity } from '../common/uuid7.entity';

@Entity('customers')
export class Customer extends Uuid7Entity {
  @Index({ unique: true })
  @Column({ length: 10 })
  mobile: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  fullName: string | null;

  /** HMAC of PAN for duplicate detection without decrypting. */
  @Index()
  @Column({ type: 'char', length: 64, nullable: true })
  panHash: string | null;

  /** AES-256-GCM encrypted PAN, needed for bureau pulls and KYC record keeping (PMLA). */
  @Column({ type: 'text', nullable: true })
  panEnc: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  panMasked: string | null;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  ckycNumber: string | null;

  /** Last 4 digits of Aadhaar only. The full number is never stored. */
  @Column({ type: 'varchar', length: 4, nullable: true })
  aadhaarLast4: string | null;

  /** eKYC provider request id (Digio KID…), kept as KYC evidence. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  kycRef: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  kycVerifiedAt: Date | null;
}
