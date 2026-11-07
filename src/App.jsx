import React from 'react';
import AuthGate from './components/AuthGate';
import { DialogProvider } from './components/Dialog';
import NotesApp from './components/NotesApp';
import { DEMO } from './demo/mode';
import DemoBanner from './demo/DemoBanner';

export default function App() {
  return (
    <>
      {DEMO && <DemoBanner />}
      <AuthGate>
        <DialogProvider>
          <NotesApp />
        </DialogProvider>
      </AuthGate>
    </>
  );
}
