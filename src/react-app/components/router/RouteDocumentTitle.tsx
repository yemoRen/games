import { useLocation, useMatches } from 'react-router';
import { formatDocumentTitle, resolveRouteTitle } from '@app/lib/router/routeTitle';

export function RouteDocumentTitle() {
  const location = useLocation();
  const matches = useMatches();
  // 收打撤（/survival*）是独立游戏，标题不加「万界道友」后缀
  const isSurvival = location.pathname.startsWith('/survival');
  const title = formatDocumentTitle(
    resolveRouteTitle(matches, location),
    isSurvival ? null : undefined,
  );

  return <title>{title}</title>;
}
