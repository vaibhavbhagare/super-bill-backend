const { canAccess } = require("../access/accessControl");

const requireFeature = (feature) => (req, res, next) => {
  const allowed = canAccess(
    {
      role: req.user?.role,
      subscriptionTier: req.store?.subscriptionTier,
      featureOverrides: req.store?.featureOverrides,
    },
    feature,
  );

  if (!allowed) {
    return res.status(403).json({
      error: "This feature is not available on your subscription plan",
      code: "FEATURE_FORBIDDEN",
      feature,
    });
  }

  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "super_admin") {
    return res.status(403).json({
      error: "Super admin only",
      code: "FORBIDDEN",
    });
  }
  next();
};

module.exports = { requireFeature, requireSuperAdmin };
