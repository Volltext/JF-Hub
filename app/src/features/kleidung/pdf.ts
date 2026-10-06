import { shareBinaryFile } from '@/core/native/files';
import { DEMO_NEEDS_SERVER, IS_DEMO } from '@/core/env';
import { ProtoError, loadConn, request } from '@/features/protokolle/http';
import type { ClothingPdfRequest } from './model';

/** Lässt den JF-Hub-Server die Kleidertabelle als PDF setzen (Layout wie die Protokolle) und teilt sie. */
export async function shareClothingPdf(body: ClothingPdfRequest): Promise<void> {
  if (IS_DEMO) throw new Error(DEMO_NEEDS_SERVER);
  const conn = await loadConn();
  if (!conn.url || !conn.token)
    throw new Error('Das PDF erstellt der JF-Hub-Server. Bitte zuerst unter Einstellungen → Server & Verbindungen anmelden.');
  let base64: string;
  try {
    base64 = await request<string>(conn, 'POST', '/api/clothing/pdf', body, true);
  } catch (e) {
    if (e instanceof ProtoError && e.status === 404) throw new Error('Der JF-Hub-Server kennt dieses PDF noch nicht – bitte den Server auf Version 1.6.1 aktualisieren.');
    if (e instanceof ProtoError && e.status === 0) throw new Error('Keine Verbindung zum JF-Hub-Server – das PDF wird dort erstellt.');
    throw e;
  }
  await shareBinaryFile(`Kleidertabelle ${body.date}.pdf`, base64, 'application/pdf');
}
