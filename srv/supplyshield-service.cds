using {
  disruptions,
  shipments,
  medicines,
  facilities,
  recovery_plans,
  recovery_options,
  audit_log
} from '../db/schema';

service SupplyShieldService {
  action runAnalysis(disruptionId: String(20), actor: String(40)) returns Map;
  action refreshWeather() returns Map;
  action createDisruption(type: String(30), location: String(60), severity: String(10), duration: String(40), description: String(500)) returns Map;
  action approveRecoveryPlan(planId: String(20), optionId: String(20), actor: String(80), comment: String(300)) returns Map;
  action rejectRecoveryPlan(planId: String(20), optionId: String(20), actor: String(80), comment: String(300)) returns Map;
  action approveRecoveryOption(optionId: String(20), actor: String(80), comment: String(300)) returns Map;
  function overview() returns Map;
  function health() returns Map;
  function currentRecoveryPlan() returns Map;
  function integrationsStatus() returns Map;
  function listDisruptions() returns Map;
  function disruptionDetails(id: String(20)) returns Map;
  function shipmentOverview() returns Map;
  function shipmentDetails(id: String(10)) returns Map;
  function inventoryOverview() returns Map;
  function recoveryPlanDetails(id: String(20)) returns Map;
  function complianceOverview() returns Map;
  function auditHistory() returns Map;

  @readonly
  entity Disruptions as projection on disruptions;

  @readonly
  entity Shipments as projection on shipments;

  @readonly
  entity Medicines as projection on medicines;

  @readonly
  entity Facilities as projection on facilities;

  @readonly
  entity RecoveryPlans as projection on recovery_plans;

  @readonly
  entity RecoveryOptions as projection on recovery_options;

  @readonly
  entity AuditLog as projection on audit_log;
}