import { Column, Entity, Index } from 'typeorm';
import { Role } from '../common/roles';
import { Uuid7Entity } from '../common/uuid7.entity';

@Entity('staff_users')
export class StaffUser extends Uuid7Entity {
  @Index({ unique: true })
  @Column({ length: 200 })
  email: string;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 120 })
  title: string;

  @Column({ type: 'text' })
  passwordHash: string;

  /** TOTP secret (base32). MFA is mandatory for every staff login. */
  @Column({ type: 'text' })
  totpSecret: string;

  @Column({ type: 'enum', enum: Role, array: true })
  roles: Role[];

  @Column({ default: true })
  active: boolean;
}
