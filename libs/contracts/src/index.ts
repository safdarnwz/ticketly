/**
 * @contracts — cross-cutting enums and constants shared by multiple bounded
 * contexts. Anything here is a stable, public part of the domain vocabulary.
 * Context-private types live inside their own module, not here.
 */
export * from './channels';
export * from './permissions';
