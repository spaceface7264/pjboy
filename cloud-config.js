// PJBoy cloud-save config. The anon (publishable) key is a PUBLIC client key —
// safe to commit and ship to the browser. Real protection is the SQL RLS + RPCs.
//
// Until both fields are filled in, CloudSync stays OFF and the game behaves
// exactly as before (local-only saves). Fill these from the Supabase dashboard:
//   Project Settings -> API  ->  Project URL  and  anon/publishable key.
window.PJBOY_CLOUD = {
  url: 'https://beqzprlbnqrhxsrhibym.supabase.co',
  anonKey: 'sb_publishable__aUMOFuxzE6quUa8Cj0jUA_QZNBn3Z_'   // public publishable key
};
