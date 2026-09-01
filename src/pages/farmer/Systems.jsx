import React, { useMemo } from 'react';
import { useStore } from '../../lib/store.jsx';
import { SystemCard } from '../../components/SystemCard.jsx';
import { EmptyState } from '../../components/ui.jsx';
import { t } from '../../i18n/strings.js';

export default function FarmerSystems() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const devices = useMemo(() => state.devices.filter((d) => d.farmerId === state.session.id), [state.devices, state.session.id]);
  return (
    <div>
      <h1>{t('nav.systems', lang)}</h1>
      <p className="muted">Each Broodiinnox system assigned to your account. Click a card to monitor and control it.</p>
      {devices.length === 0 ? (
        <EmptyState icon="🛠️" text="No systems assigned yet — contact your Afriinnox provider." />
      ) : (
        <div className="grid cols-2" style={{ marginTop: 16 }}>
          {devices.map((d) => <SystemCard key={d.id} device={d} lang={lang} />)}
        </div>
      )}
    </div>
  );
}
