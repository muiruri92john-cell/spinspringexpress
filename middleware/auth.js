// =====================================================
// middleware/auth.js — Shared authentication guards
// =====================================================

function isAuth(req, res, next) {
  if (req.session.spinUser) return next();
  req.flash('error_msg', 'Please login first');
  return res.redirect('/login');
}

function isOwner(req, res, next) {
  if (req.session.spinUser?.role === 'owner') return next();
  req.flash('error_msg', 'Owner access required');
  return res.redirect('/login');
}

function isAttendant(req, res, next) {
  const role = req.session.spinUser?.role;
  if (role === 'attendant' || role === 'owner') return next();
  req.flash('error_msg', 'Attendant access required');
  return res.redirect('/attendant-login');
}

function isCustomer(req, res, next) {
  if (req.session.spinUser?.role === 'customer') return next();
  req.flash('error_msg', 'Customer access required');
  return res.redirect('/customer-login');
}

function getOwnerId(req) {
  const u = req.session.spinUser;
  if (!u) return null;
  if (u.role === 'owner') return u.id;
  return u.ownerId || null;
}

module.exports = {
  isAuth,
  isOwner,
  isAttendant,
  isCustomer,
  getOwnerId
};