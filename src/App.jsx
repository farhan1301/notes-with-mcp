import React from 'react';
import AuthGate from './components/AuthGate';
import { DialogProvider } from './components/Dialog';
import NotesApp from './components/NotesApp';

export default function App() {
  return (
    <AuthGate>
      <DialogProvider>
        <NotesApp />
      </DialogProvider>
    </AuthGate>
  );
}
