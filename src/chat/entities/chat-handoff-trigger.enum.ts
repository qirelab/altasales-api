/**
 * Reason the platform chat requested a human operator. Kept as a separate
 * enum from the chatbot-service HandoffTrigger type so persistence and
 * runtime detection can evolve independently — the two just need to stay in
 * 1:1 mapping.
 */
export enum ChatHandoffTrigger {
  /** Client asked in plain text to be connected to a human. */
  UserExplicitRequest = 'user_explicit_request',
  /** RAG could not ground an answer (no results / below threshold / empty question). */
  RagNoContext = 'rag_no_context',
  /** RAG failed with an infrastructure error (retrieval / generation / oversize). */
  RagInfraError = 'rag_infra_error',
}
