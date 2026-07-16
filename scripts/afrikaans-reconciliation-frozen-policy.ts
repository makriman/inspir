export type AfrikaansReconciliationFrozenPolicy = Readonly<{
  adapterImplementationSha256: string;
  candidateValidatorImplementationSha256: string;
  preparedPlanSha256: string;
  workbenchSha256: string;
  workbenchReadmeSha256: string;
  noModelGateEvidenceSha256: string;
  scopeFileSha256: string;
  scopeCanonicalSha256: string;
  repairWorklistTreeSha256: string;
  exactDecisionFields: number;
  exactDecisionRootSha256: string;
  unresolvedFields: number;
  unresolvedSemanticRootSha256: string;
  totalProposalFields: number;
  semanticDecisions: number;
  resolutionVerifierImplementationSha256: string;
  resolutionPartitionPlanSha256: string;
  resolutionReviewBundleSha256: string;
  resolutionReviewerAEvidenceSha256: string;
  resolutionReviewerBEvidenceSha256: string;
  resolutionFrozenPolicySha256: string;
  resolutionValidatorPolicySha256: string;
  thirdValueProposalsSha256: string;
  thirdValueReviewSha256: string;
  escalationDecisionRootSha256: string;
  thirdValueRootSha256: string;
  resolvedEscalationDecisionRootSha256: string;
  resolvedEscalationDecisions: number;
  resolvedEscalationFields: number;
}>;

/**
 * Frozen production inputs for the tracked Afrikaans reconciliation adapter.
 *
 * This lives outside the adapter so the approved adapter byte hash does not
 * create a self-referential hash loop. Update the implementation hash only
 * after the adapter has passed its full verification suite.
 */
export const AFRIKAANS_RECONCILIATION_FROZEN_V3_POLICY = Object.freeze({
  adapterImplementationSha256:
    "609d1ca0c7e9d25e435f6d34054b8dbc3422b8e76d4a481f5ff5cb1a79387622",
  candidateValidatorImplementationSha256:
    "e17fc05a884640495659ae54e42604d98d35c2a40c395a35ebb7a1ed43cee0d5",
  preparedPlanSha256: "e1c0fbddce2287467d0b7a08e64735226099ccd543e2c60f15a3b60907c95a11",
  workbenchSha256: "110eefd87d608738e152d69e17e772cc349d24e13bc2f2aec305897734c9611a",
  workbenchReadmeSha256: "535493a43e45bb3a55527dd1a989271bd0923596e87d47c458f9045cd9b22fcc",
  noModelGateEvidenceSha256:
    "3d8ac2c780e024568fe5309c3af884c16c2c4a58aeaa0a02a6c2367aac9f389a",
  scopeFileSha256: "d1c056c60ad124af72e7ab9afc2942f1ab713ce1a41aff4ad3f7b303fa7ec169",
  scopeCanonicalSha256:
    "a86e3d4d082ce73e499306121ab3964eaf9f099eb8c6f0d322335cf5eb78144c",
  repairWorklistTreeSha256:
    "4c870c1867e46a01c064f948bc1595926d1db6b8c657305dcf3c8ecf8a62b847",
  exactDecisionFields: 180,
  exactDecisionRootSha256:
    "b24c59d77ae676a5fd9db6e2bf61c11c437fcdf721f2467c6e1c295b8c03fcf1",
  unresolvedFields: 563,
  unresolvedSemanticRootSha256:
    "441cf3b36224bbdb2f49f5d17af1f6e953cad2c9d9ad7ac0896efbb764280b26",
  totalProposalFields: 743,
  semanticDecisions: 535,
  resolutionVerifierImplementationSha256:
    "624c8c42cd2e3938d83d11e4cc48f514a1710433ab4241bf0cd12942982fedb0",
  resolutionPartitionPlanSha256:
    "26d79b70458b7a01c1e24aab0183a8b8a5608d18878c0fda6e83c7b6cd33b74f",
  resolutionReviewBundleSha256:
    "cb230d18703aaff2298fca9e780e12531670ec204ea655f969c45e814b97bf34",
  resolutionReviewerAEvidenceSha256:
    "8f874ba98878aa286ba14ca0fdc717c71dad6194e4d7f89aee81848e7e6f8ecd",
  resolutionReviewerBEvidenceSha256:
    "db869863af2f90372ba8789268cd4409f8e3be433ce13eee655bbb87b3f80304",
  resolutionFrozenPolicySha256:
    "26d71022238eb86857e8b125fa34174585553b81945d9d9f6738827554cd02aa",
  resolutionValidatorPolicySha256:
    "9b2200f5dd506cc735fb9b0c3b99ebbc3087b39bb26b697946be020b42e0305c",
  thirdValueProposalsSha256:
    "d1087ac178a090e31d30409cba0accccecfeb7e7616499b99128d065dbfffbdb",
  thirdValueReviewSha256:
    "494fee5665a0f3cfc5f86c102c79c65cde94d7b0c34dff788787ed9bb11dc186",
  escalationDecisionRootSha256:
    "70ad7c8b16c695d68953552dbd9a424d728d234c1b3818407d80736f6accead0",
  thirdValueRootSha256:
    "8df3ea261d3a6daa87f5a4944394587bac7df3d523e3de789113a1ec8d0430e6",
  resolvedEscalationDecisionRootSha256:
    "a586161649034068cac7b75a2aaa539454a09e4a7f52bff69fb939179d5ddd81",
  resolvedEscalationDecisions: 17,
  resolvedEscalationFields: 17,
} satisfies AfrikaansReconciliationFrozenPolicy);
