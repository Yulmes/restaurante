import { orderMeta } from '../../cart/OrderShell.tsx';
import { OrderPage } from '../pedido/confirmacion.tsx';
import type { Route } from './+types/seguimiento';

/** Seguimiento de un pedido propio (M7, D3): la página del pedido con la línea de marea. */
export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'tracking.metaTitle');
}

export default function Seguimiento() {
  return <OrderPage mode="tracking" />;
}
