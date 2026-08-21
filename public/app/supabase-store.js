(function (global) {
  const FAMILY_ID_KEY = "alz:family-id";
  const FAMILY_CODE_KEY = "alz:code";
  const FAMILY_ROLE_KEY = "alz:role";
  const BACKEND_MESSAGE = "Unable to connect to your family right now.";

  function errorMessage(error) {
    return error && error.message ? error.message : "Unable to initialize Supabase authentication.";
  }

  function lifecycleError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function backendError() {
    return lifecycleError("BACKEND_ERROR", BACKEND_MESSAGE);
  }

  function singleRow(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  function createSupabaseStore({ client, newFamily, onStatus, storage }) {
    let user = null;
    let state = null;
    let familyId = null;
    let revision = -1;
    let channel = null;
    let initialization = null;
    const subscribers = [];

    function readSelection(key) {
      if (!storage) return null;
      return storage.getItem ? storage.getItem(key) : storage.get(key) || null;
    }

    function writeSelection(key, value) {
      if (!storage) return;
      if (storage.setItem) storage.setItem(key, value);
      else storage.set(key, value);
    }

    function removeSelection(key) {
      if (!storage) return;
      if (storage.removeItem) storage.removeItem(key);
      else storage.delete(key);
    }

    function clearSelection() {
      removeSelection(FAMILY_ID_KEY);
      removeSelection(FAMILY_CODE_KEY);
      removeSelection(FAMILY_ROLE_KEY);
      familyId = null;
      revision = -1;
      state = null;
    }

    function emit() {
      subscribers.forEach((subscriber) => subscriber(state));
    }

    function adopt(row, selectedRole) {
      familyId = row.family_id;
      revision = Number(row.revision);
      state = row.payload;
      writeSelection(FAMILY_ID_KEY, familyId);
      writeSelection(FAMILY_CODE_KEY, row.family_code);
      writeSelection(FAMILY_ROLE_KEY, selectedRole);
      emit();
    }

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

    async function create(lang) {
      await initialize();
      onStatus("loading");

      let result;
      try {
        result = await client.rpc("create_family", {
          initial_payload: newFamily("", lang),
          requested_role: "family",
        });
      } catch (_error) {
        result = { data: null, error: true };
      }

      const row = singleRow(result.data);
      if (result.error || !row) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      adopt(row, "family");
      onStatus("synced");
      return row.family_code;
    }

    async function attach(code, selectedRole) {
      await initialize();
      onStatus("loading");

      let result;
      try {
        result = await client.rpc("join_family", {
          family_code: code,
          requested_role: selectedRole,
        });
      } catch (_error) {
        result = { data: null, error: true };
      }

      if (result.error) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      const row = singleRow(result.data);
      if (!row) {
        const error = lifecycleError("FAMILY_NOT_FOUND", "Family not found.");
        onStatus("error", error.message);
        throw error;
      }

      adopt(row, selectedRole);
      onStatus("synced");
      return state;
    }

    async function restoreSelection() {
      const cachedFamilyId = readSelection(FAMILY_ID_KEY);
      const cachedCode = readSelection(FAMILY_CODE_KEY);
      const cachedRole = readSelection(FAMILY_ROLE_KEY);

      if (
        !cachedFamilyId ||
        !/^\d{6}$/.test(cachedCode || "") ||
        (cachedRole !== "family" && cachedRole !== "elder")
      ) {
        clearSelection();
        return null;
      }

      await initialize();
      onStatus("loading");

      let membershipResult;
      try {
        membershipResult = await client
          .from("family_members")
          .select("family_id, role, families!inner(code)")
          .eq("family_id", cachedFamilyId)
          .eq("user_id", user.id)
          .eq("role", cachedRole)
          .eq("families.code", cachedCode)
          .maybeSingle();
      } catch (_error) {
        membershipResult = { data: null, error: true };
      }

      if (membershipResult.error) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      const membership = singleRow(membershipResult.data);
      const membershipCode = Array.isArray(membership?.families)
        ? membership.families[0]?.code
        : membership?.families?.code;
      if (
        !membership ||
        membership.family_id !== cachedFamilyId ||
        membership.role !== cachedRole ||
        membershipCode !== cachedCode
      ) {
        clearSelection();
        onStatus("synced");
        return null;
      }

      let stateResult;
      try {
        stateResult = await client
          .from("family_states")
          .select("family_id, revision, payload")
          .eq("family_id", cachedFamilyId)
          .maybeSingle();
      } catch (_error) {
        stateResult = { data: null, error: true };
      }

      const row = singleRow(stateResult.data);
      if (stateResult.error || !row || row.payload?.code !== cachedCode) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      adopt({ ...row, family_code: cachedCode }, cachedRole);
      onStatus("synced");
      return state;
    }

    return {
      initialize,
      create,
      attach,
      restoreSelection,
      get: () => state,
      role: () => readSelection(FAMILY_ROLE_KEY),
      subscribe: (subscriber) => subscribers.push(subscriber),
    };
  }

  global.createSupabaseStore = createSupabaseStore;
})(typeof window === "undefined" ? globalThis : window);
