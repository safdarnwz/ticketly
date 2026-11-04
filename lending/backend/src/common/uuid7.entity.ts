import { BeforeInsert, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

/**
 * Every table uses a UUIDv7 primary key: globally unique, generated in the app,
 * and time-ordered, so B-tree inserts stay sequential and ids sort by creation time.
 */
export abstract class Uuid7Entity {
  @PrimaryColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @BeforeInsert()
  assignUuid7() {
    if (!this.id) this.id = uuidv7();
  }
}

export const newId = () => uuidv7();
