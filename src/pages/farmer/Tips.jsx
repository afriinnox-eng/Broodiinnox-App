import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { ANIMALS } from '../../lib/presets.js';
import { Card, EmptyState, Tabs } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { t } from '../../i18n/strings.js';

const GUIDES = {
  chicken: [
    ['Day 1–7', 'Keep the box at 35–37°C. Chicks should spread evenly — if they huddle under the lamp it is too cold; if they spread to the walls it is too hot.'],
    ['Day 8–14', 'Drop the target by about 1°C. Watch for droppings and keep bedding dry to avoid disease.'],
    ['Day 15–21', 'Continue lowering heat gradually. Open ventilation a little during the day. Prepare the grow-out pen.'],
  ],
  duck: [
    ['Day 1–7', 'Ducklings like 33–35°C. They drink a lot — keep water topped up and away from the heat lamp.'],
    ['Day 8–28', 'Reduce heat each week. Ducklings are cold-hardy, but drafts still kill — keep the box shielded.'],
  ],
  turkey: [
    ['Day 1–7', 'Poults need 34–36°C and zero drafts. Use clean litter and check them twice a day.'],
    ['Day 8–28', 'Step heat down weekly. Turkeys grow fast — give them space before they crowd.'],
  ],
  pig: [
    ['Day 1–7', 'Piglets need 30–32°C. They pile up when cold — if you see a pile, raise the heat.'],
    ['Day 8–21', 'Lower heat weekly. Keep the creep area clean and dry; add fresh straw daily.'],
  ],
};

export default function FarmerTips() {
  const { state } = useStore();
  const lang = state.lang || 'en';
  const [animal, setAnimal] = useState('chicken');
  const p = ANIMALS[animal];

  return (
    <div>
      <h1>{t('nav.tips', lang)}</h1>
      <p className="muted">Short, practical brooding guidance — and what your Broodiinnox system does automatically.</p>

      <Tabs tabs={Object.values(ANIMALS).map((a) => ({ key: a.key, label: a.label }))} active={animal} onChange={setAnimal} />

      <div className="grid cols-2">
        <Card title={`${p.label} — recommended range`}>
          <div className="row" style={{ gap: 18 }}>
            <div>
              <div className="muted small">Start temperature</div>
              <div className="big" style={{ color: 'var(--brand-blue)' }}>{p.baseMin}–{p.baseMax}°C</div>
            </div>
            <div>
              <div className="muted small">Cycle length</div>
              <div className="big">{p.durationDays} days</div>
            </div>
            <div>
              <div className="muted small">Safety floor</div>
              <div className="big" style={{ color: 'var(--crit)' }}>{p.safetyFloor}°C</div>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>Broodiinnox steps the target range down automatically as the animals grow — you don't need to remember to change anything.</p>
          <div className="warn-banner"><Icon name="pin" size={18} /><div>{p.tips}</div></div>
        </Card>

        <Card title="Week by week">
          {GUIDES[animal]?.length ? GUIDES[animal].map(([when, text]) => (
            <div key={when} className="alert-line">
              <div>
                <b>{when}</b>
                <div className="muted small">{text}</div>
              </div>
            </div>
          )) : <EmptyState icon="book" text="Guide coming soon." />}
        </Card>
      </div>

      <Card title="Before you start a batch — checklist" style={{ marginTop: 14 }}>
        <div className="grid cols-2">
          {[
            'Place all sensors inside the brooding box at chick height',
            'Enable every sensor you use (My Systems → open a system → Sensors)',
            'Set Max and Min targets — or use the preset when starting a batch',
            'Set the total days and start date when starting the batch',
            'Make sure the subscription is active so the device stays unlocked',
            'Keep the SIM card and antenna clean for a strong 4G signal',
          ].map((item, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <Icon name="check" size={16} style={{ color: 'var(--brand-green)', flex: 'none' }} /> <span>{item}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
