/** Headers every FSM API call needs (besides Authorization). */
export function fsmHeaders(accountId: string, companyId: string): Record<string, string> {
  return {
    "X-Account-ID": accountId,
    "X-Company-ID": companyId,
    "X-Client-ID": "opusm-skill-assessment",
    "X-Client-Version": "1.0",
    "X-Requested-With": "com.sap.fsm",
  };
}
