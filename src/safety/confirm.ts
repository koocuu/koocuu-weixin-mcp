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

export function disabledRiskyActionResult(action: string, payload: unknown) {
  return {
    dryRun: true,
    disabled: true,
    action,
    message:
      "No changes were made. Set WECHAT_ENABLE_PUBLISH=true in the deployment environment before executing publishing actions.",
    payload,
  };
}
