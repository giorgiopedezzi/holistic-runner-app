// The "shadcn-big-calendar/styles" export points at a real .css file, but the
// subpath itself doesn't end in ".css" — so vite/client's ambient `*.css`
// module declaration (which matches by suffix) doesn't cover it. One-line
// declaration for that one specifier.
declare module "shadcn-big-calendar/styles";
