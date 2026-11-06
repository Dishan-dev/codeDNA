# Snackshop

A small snack shop built "the vibe-coded way": customers browse snacks, favorite them, apply a coupon and place an order; staff export orders.

CodeDNA test fixture. Some parts are deliberately hard or impossible to follow statically:
- `components/export-button.tsx` loads code with a dynamic `import()`.
- `lib/notify.ts` picks a function using an environment setting.
- `app/actions/favorites.ts` changes data without a sign-in check.
- `formatPrice` is duplicated in `lib/format.ts` and `components/cart-summary.tsx`.
