const { TierEntitlements } = require("./subscription");
const { RoleEntitlements } = require("./roles");

const DEFAULT_TIER = "standard";

const getTierSet = (tier, overrides = {}) => {
  const baseTier = tier === "custom" ? "premium" : tier;
  const base = new Set(TierEntitlements[baseTier] || TierEntitlements.standard);

  Object.entries(overrides || {}).forEach(([feature, enabled]) => {
    if (enabled) base.add(feature);
    else base.delete(feature);
  });

  return base;
};

const canAccess = ({ role, subscriptionTier, featureOverrides }, feature) => {
  if (role === "super_admin") return true;
  if (!role) return false;

  const roleAllowed = RoleEntitlements[role]?.allowed?.has(feature);
  if (!roleAllowed) return false;

  const tier = subscriptionTier || DEFAULT_TIER;
  return getTierSet(tier, featureOverrides).has(feature);
};

module.exports = { canAccess, DEFAULT_TIER };
