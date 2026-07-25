# Frontend Backend-Readiness Validation

This validation tracks the Phase 5 requirement that production routes use backend
authorization and do not depend on local business-data mocks.

## Integrated flows

- Login, current-user lookup, token refresh, and logout use `/api/v1/auth`.
- Access and refresh tokens remain in HTTP-only cookies behind the frontend proxy.
- Customer and employee list/create/update/archive flows use the API.
- Categories, units, products, and inventory balances/movements use the API.
- Frontend route visibility remains a usability control; the API remains the
  authorization boundary.

## Remaining production blockers

- Service-order columns and service orders still use local initial data.
- Point-of-sale completion and cash-session operations still use the browser store.
- Sales history and its chart series still use local initial data.
- Dashboard revenue, order, and AI cards still use local initial data.
- Intelligence reports still use local historical, order, and insight fixtures.
- Global search still indexes local service-order and history fixtures.

Frontend preferences such as theme, font size, and sidebar state are local UI state and
are not business-data blockers.

The backend-readiness acceptance criterion is not met until every blocker above is
replaced and the affected admin and employee routes pass end-to-end authorization
tests.
