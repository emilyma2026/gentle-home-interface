(function (global) {
  function errorMessage(error) {
    return error && error.message ? error.message : "Unable to initialize Supabase authentication.";
  }

  function createSupabaseStore({ client, newFamily, onStatus, storage }) {
    let user = null;
    let state = null;
    let familyId = null;
    let revision = -1;
    let channel = null;
    let initialization = null;
    const subscribers = [];

    function initialize() {
      if (initialization) return initialization;

      initialization = initializeSession();
      return initialization;
    }

    async function initializeSession() {
      onStatus("connecting");

      try {
        const sessionResult = await client.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;

        if (sessionResult.data.session?.user) {
          user = sessionResult.data.session.user;
        } else {
          const signInResult = await client.auth.signInAnonymously();
          if (signInResult.error) throw signInResult.error;
          user = signInResult.data.user;
        }

        if (!user) throw new Error("Anonymous authentication did not return a user.");

        onStatus("synced");
        return user;
      } catch (error) {
        onStatus("error", errorMessage(error));
        initialization = null;
        throw error;
      }
    }

    return { initialize };
  }

  global.createSupabaseStore = createSupabaseStore;
})(typeof window === "undefined" ? globalThis : window);
