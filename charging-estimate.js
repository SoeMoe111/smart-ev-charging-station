// Display-only charging model. Never write these estimates to Firebase or use
// them for relay control, card authorization, or hardware protection.
export const ESTIMATED_CC_CURRENT_A = 1.5;
const PRECHARGE_VOLTAGE = 5.8;
const CV_START_VOLTAGE = 8.3;
const FULL_VOLTAGE = 8.4;

export function chargingEstimate(slot = {}, nowMs = Date.now(), staleMs = 15000) {
  const timestamp = Number(slot.updatedAt);
  const age = nowMs - timestamp;
  const fresh = Number.isFinite(timestamp) && timestamp > 0 &&
    age >= 0 && age <= staleMs;
  const measuredVoltage = Number(slot.voltage);
  const voltage = Number.isFinite(measuredVoltage) && measuredVoltage > 0
    ? measuredVoltage : 0;
  const protection = String(slot.protection || "NORMAL").trim().toUpperCase();
  const charging = fresh && slot.relay === true &&
    String(slot.state || "").toLowerCase() === "charging" &&
    protection === "NORMAL";

  let current = 0;
  if (charging && voltage > 0 && voltage < FULL_VOLTAGE) {
    if (voltage < PRECHARGE_VOLTAGE) {
      current = ESTIMATED_CC_CURRENT_A * 0.2;
    } else if (voltage <= CV_START_VOLTAGE) {
      current = ESTIMATED_CC_CURRENT_A;
    } else {
      // An illustrative voltage-based taper, not a measured charging current.
      current = ESTIMATED_CC_CURRENT_A *
        (FULL_VOLTAGE - voltage) / (FULL_VOLTAGE - CV_START_VOLTAGE);
    }
  }

  return { fresh, charging, voltage, current, power: voltage * current };
}
