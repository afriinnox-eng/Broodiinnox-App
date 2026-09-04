import React, { useState } from 'react';
import { useStore } from '../../lib/store.jsx';
import { Badge, Btn, DataTable, Field, Modal } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { t } from '../../i18n/strings.js';

export default function AdminInventory() {
  const { state, dispatch } = useStore();
  const lang = state.lang || 'en';
  const [addOpen, setAddOpen] = useState(false);
  const low = state.inventory.filter((i) => i.stock <= i.minStock);

  const adjust = (id, delta) => {
    const item = state.inventory.find((i) => i.id === id);
    dispatch({ type: 'INVENTORY_UPDATE', id, patch: { stock: Math.max(0, item.stock + delta) } });
  };

  return (
    <div>
      <div className="row-between">
        <h1>{t('nav.inventory', lang)} <span className="pill">{state.inventory.length} items</span></h1>
        <Btn variant="primary" onClick={() => setAddOpen(true)}>+ Add item</Btn>
      </div>

      {low.length > 0 && (
        <div className="warn-banner" style={{ margin: '12px 0' }}>
          <Icon name="box" size={20} /> <div><b>{low.length} item(s) below minimum stock</b> — order soon so field maintenance is never delayed.</div>
        </div>
      )}

      <DataTable
        columns={[
          { key: 'name', label: 'Item', render: (r) => <div><b>{r.name}</b><div className="muted small">{r.sku}</div></div> },
          { key: 'stock', label: 'In stock', render: (r) => <b>{r.stock} {r.unit}</b> },
          { key: 'min', label: 'Min stock', render: (r) => r.minStock },
          { key: 'level', label: 'Level', render: (r) => {
            const pct = (r.stock / Math.max(1, r.minStock * 2)) * 100;
            return (
              <div style={{ width: 120 }}>
                <div className="progress"><div style={{ width: `${Math.min(100, pct)}%`, background: r.stock <= r.minStock ? 'var(--crit)' : 'var(--brand-green)' }} /></div>
              </div>
            );
          } },
          { key: 'actions', label: '', render: (r) => (
            <div className="btn-row">
              <Btn small onClick={() => adjust(r.id, -1)}>−</Btn>
              <Btn small onClick={() => adjust(r.id, 1)}>+</Btn>
            </div>
          )},
        ]}
        rows={state.inventory.map((i) => ({ ...i, _key: i.id }))}
      />

      {addOpen && <AddItemModal dispatch={dispatch} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddItemModal({ dispatch, onClose }) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [stock, setStock] = useState('10');
  const [minStock, setMin] = useState('5');
  const stockNum = Number(stock);
  const minNum = Number(minStock);
  const formValid = name.trim() !== ''
    && Number.isInteger(stockNum) && stockNum >= 0
    && Number.isInteger(minNum) && minNum >= 0;
  const save = () => {
    if (!formValid) return;
    dispatch({ type: 'INVENTORY_ADD', item: { name, sku, stock: stockNum, minStock: minNum, unit: 'pcs' } });
    dispatch({ type: 'TOAST', msg: 'Item added to inventory.' });
    onClose();
  };
  return (
    <Modal title="Add inventory item" onClose={onClose}>
      <Field label="Item name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="SKU"><input value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
      <div className="grid cols-2" style={{ gap: 10 }}>
        <Field label="Initial stock"><input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
        <Field label="Minimum stock"><input type="number" min={0} value={minStock} onChange={(e) => setMin(e.target.value)} /></Field>
      </div>
      <div className="btn-row"><Btn variant="primary" disabled={!formValid} onClick={save}>Add</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
