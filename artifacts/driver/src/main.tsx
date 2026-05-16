// Single side-effect import so Sentry initializes BEFORE the App module
// graph is evaluated. Any import-time crashes inside App are then captured.
import './bootstrap';
