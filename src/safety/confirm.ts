export function shouldExecuteRiskyAction(input: {
  confirm?: boolean;
  dryRun?: boolean;
}) {
  return input.confirm === true && input.dryRun !== true;
}

export function riskyDryRunResult(action: string, payload: unknown) {
  return {
    dryRun: true,
    action,
    message: "No changes were made. Set confirm: true and dryRun: false to execute.",
    payload,
  };
}
