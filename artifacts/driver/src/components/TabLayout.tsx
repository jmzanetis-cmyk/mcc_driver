import { Outlet } from 'react-router-dom';
import { TabBar } from './TabBar';

export function TabLayout() {
  return (
    <>
      <div style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}>
        <Outlet />
      </div>
      <TabBar />
    </>
  );
}
