"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { getProductSettings, saveProductSettings } from "@/lib/productSettings";
import { AMAZON_ASSOCIATE_DISCLOSURE, CuratedCollection, CURATED_COLLECTIONS, DEFAULT_PRODUCT_SETTINGS, ProductSettings } from "@/lib/types";

export default function Settings() {
  const [settings, setSettings] = useState<ProductSettings>(DEFAULT_PRODUCT_SETTINGS);
  const [message, setMessage] = useState("");

  useEffect(() => { setSettings(getProductSettings()); }, []);

  function change<K extends keyof ProductSettings>(key: K, value: ProductSettings[K]) {
    setSettings(s => ({ ...s, [key]: value }));
  }

  function toggleCollection(c: CuratedCollection) {
    setSettings(s => ({ ...s, defaultCollections: s.defaultCollections.includes(c) ? s.defaultCollections.filter(x => x !== c) : [...s.defaultCollections, c] }));
  }

  function save() {
    saveProductSettings(settings);
    setMessage("Settings saved.");
  }

  function resetDisclosure() {
    change("disclosureText", AMAZON_ASSOCIATE_DISCLOSURE);
  }

  return <AppShell>
    <div className="top">
      <div>
        <div className="eyebrow">Product Studio</div>
        <h1 className="title">Settings</h1>
        <div className="muted">Brand voice, default collections, and affiliate disclosure — applied to new products you generate.</div>
      </div>
    </div>

    <section className="card">
      <h2>Brand &amp; Voice</h2>
      <div className="fields">
        <div className="field full">
          <label>Brand voice</label>
          <textarea rows={3} value={settings.brandVoice} onChange={e => change("brandVoice", e.target.value)} />
        </div>
        <div className="field">
          <label>Social tone</label>
          <input value={settings.socialTone} onChange={e => change("socialTone", e.target.value)} />
        </div>
        <div className="field">
          <label>CTA button color</label>
          <input type="color" value={settings.buttonColor} onChange={e => change("buttonColor", e.target.value)} style={{ height: 42, padding: 4 }} />
        </div>
      </div>
    </section>

    <section className="card saved">
      <h2>Affiliate Disclosure</h2>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Shown automatically on every Amazon Affiliate product. Required by FTC guidelines — edit wording, but don&apos;t remove it.</div>
      <div className="fields">
        <div className="field full">
          <label>Disclosure text</label>
          <textarea rows={2} value={settings.disclosureText} onChange={e => change("disclosureText", e.target.value)} />
        </div>
      </div>
      <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={resetDisclosure}>Reset to standard Amazon Associates wording</button>
    </section>

    <section className="card saved">
      <h2>Default Collections</h2>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Always included alongside the collections auto-detected for each product.</div>
      <div className="pillRow">
        {CURATED_COLLECTIONS.map(c => (
          <button key={c} type="button" className={settings.defaultCollections.includes(c) ? "badge" : "secondary"} onClick={() => toggleCollection(c)}>{c}</button>
        ))}
      </div>
    </section>

    <div className="actions" style={{ marginTop: 16 }}>
      <button className="primary" onClick={save}>Save settings</button>
    </div>
    {message && <div className="status">{message}</div>}
  </AppShell>;
}
