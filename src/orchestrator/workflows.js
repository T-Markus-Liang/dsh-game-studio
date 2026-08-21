/** Deterministic V0.1 workflow plans (04-skill-registry.md §5). */

export const WORKFLOWS = Object.freeze({
  build: Object.freeze({
    phases: ['IMPLEMENT', 'BUILD', 'TEST', 'VERIFY', 'GATE', 'COMMIT'],
    skills: Object.freeze({ plan: 'create-stories', implement: 'dev-story', review: 'code-review' }),
    gates: Object.freeze(['build-pass', 'tests-pass', 'scope-clean', 'no-debug-junk', 'verifier-pass']),
  }),
  debug: Object.freeze({
    phases: ['IMPLEMENT', 'TEST', 'VERIFY', 'GATE', 'COMMIT'],
    skills: Object.freeze({ triage: 'bug-triage', fix: 'dev-story', regression: 'regression-suite' }),
    gates: Object.freeze(['tests-pass', 'no-regression', 'scope-clean', 'no-debug-junk', 'verifier-pass']),
  }),
  test: Object.freeze({
    phases: ['TEST', 'VERIFY', 'GATE'],
    skills: Object.freeze({ plan: 'qa-plan', run: 'smoke-check', evidence: 'test-evidence-review' }),
    gates: Object.freeze(['tests-pass']),
  }),
  review: Object.freeze({
    phases: ['VERIFY', 'GATE'],
    skills: Object.freeze({ solo: null, lean: 'code-review', studio: 'architecture-review' }),
    gates: Object.freeze(['verifier-pass']),
  }),
})

/** Backward-compatible flat view for route callers. */
export const WORKFLOW_PLANS = WORKFLOWS

export function workflowPlan(workflow, reviewMode = 'lean') {
  const plan = WORKFLOWS[workflow] || WORKFLOWS.build
  const skills = workflow === 'review'
    ? [plan.skills[reviewMode]].filter(Boolean)
    : Object.values(plan.skills).filter(Boolean)
  return { phases: [...plan.phases], skills, gates: [...plan.gates] }
}
