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

  function revisionConflictError() {
    return lifecycleError("REVISION_CONFLICT", BACKEND_MESSAGE);
  }

  function singleRow(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  function isFamilyId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
  }

  function isFamilyCode(value) {
    return /^[0-9]{6}$/.test(value || "");
  }

  function isFamilyRole(value) {
    return value === "family" || value === "elder";
  }

  function isRpcRow(row) {
    return Boolean(
      row &&
      isFamilyId(row.family_id) &&
      isFamilyCode(row.family_code) &&
      Number.isInteger(row.revision) &&
      row.revision >= 0 &&
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload) &&
      row.payload.code === row.family_code,
    );
  }

  function isStateRow(row, expectedFamilyId, expectedCode) {
    return Boolean(
      row &&
      row.family_id === expectedFamilyId &&
      Number.isInteger(row.revision) &&
      row.revision >= 0 &&
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload) &&
      row.payload.code === expectedCode,
    );
  }

  function isRevisionConflict(error) {
    return Boolean(
      error && (error.code === "REVISION_CONFLICT" || error.message === "REVISION_CONFLICT"),
    );
  }

  function createSupabaseStore({ client, newFamily, onStatus, storage }) {
    let user = null;
    let state = null;
    let confirmedState = null;
    let familyId = null;
    let revision = -1;
    let selectedRole = null;
    let channel = null;
    let initialization = null;
    let mutationGeneration = 0;
    let activeMutations = 0;
    let writeQueue = Promise.resolve();
    let optimisticWrite = 0;
    let pendingWrites = 0;
    const subscribers = [];

    function readSelection(key) {
      if (!storage) return null;
      try {
        return storage.getItem ? storage.getItem(key) : storage.get(key) || null;
      } catch (_error) {
        return null;
      }
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

    function clearCachedSelection() {
      [FAMILY_ID_KEY, FAMILY_CODE_KEY, FAMILY_ROLE_KEY].forEach((key) => {
        try {
          removeSelection(key);
        } catch (_error) {
          // Selection caching is best-effort and never the family-data source of truth.
        }
      });
    }

    function cacheSelection(selectedFamilyId, selectedCode, role) {
      try {
        writeSelection(FAMILY_ID_KEY, selectedFamilyId);
        writeSelection(FAMILY_CODE_KEY, selectedCode);
        writeSelection(FAMILY_ROLE_KEY, role);
      } catch (_error) {
        clearCachedSelection();
      }
    }

    function clearSelection() {
      clearCachedSelection();
      removeRealtimeChannel();
      familyId = null;
      revision = -1;
      state = null;
      confirmedState = null;
      selectedRole = null;
    }

    function emit() {
      subscribers.forEach((subscriber) => subscriber(state));
    }

    function adopt(row, role) {
      familyId = row.family_id;
      revision = Number(row.revision);
      state = row.payload;
      confirmedState = row.payload;
      selectedRole = role;
      cacheSelection(familyId, row.family_code, role);
      emit();
    }

    function removeRealtimeChannel() {
      const previousChannel = channel;
      channel = null;
      if (!previousChannel) return;

      try {
        if (client.removeChannel) {
          const removal = client.removeChannel(previousChannel);
          if (removal && typeof removal.catch === "function") removal.catch(() => {});
        } else if (previousChannel.unsubscribe) {
          previousChannel.unsubscribe();
        }
      } catch (_error) {
        // A stale channel is guarded by generation and identity checks below.
      }
    }

    function subscribeToFamily(selectedFamilyId, selectedCode, operation) {
      removeRealtimeChannel();

      try {
        const nextChannel = client.channel(`family-state:${selectedFamilyId}`);
        nextChannel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "family_states",
            filter: `family_id=eq.${selectedFamilyId}`,
          },
          (event) => {
            if (
              operation !== mutationGeneration ||
              selectedFamilyId !== familyId ||
              channel !== nextChannel
            ) {
              return;
            }

            const row = event && event.new;
            if (!isStateRow(row, selectedFamilyId, selectedCode)) return;
            const nextRevision = Number(row.revision);
            if (nextRevision <= revision) return;

            revision = nextRevision;
            state = row.payload;
            confirmedState = row.payload;
            emit();
            if (pendingWrites === 0) onStatus("synced");
          },
        );
        channel = nextChannel;
        nextChannel.subscribe((status) => {
          if (
            operation !== mutationGeneration ||
            selectedFamilyId !== familyId ||
            channel !== nextChannel
          ) {
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            onStatus("offline", BACKEND_MESSAGE);
          }
        });
      } catch (_error) {
        onStatus("offline", BACKEND_MESSAGE);
      }
    }

    function startRealtime(row, operation) {
      subscribeToFamily(row.family_id, row.family_code, operation);
    }

    async function readMembership(selectedFamilyId, selectedCode) {
      try {
        return await client
          .from("family_members")
          .select("family_id, role, families!inner(code)")
          .eq("family_id", selectedFamilyId)
          .eq("user_id", user.id)
          .eq("families.code", selectedCode)
          .maybeSingle();
      } catch (_error) {
        return { data: null, error: true };
      }
    }

    function validMembership(result, selectedFamilyId, selectedCode) {
      const membership = singleRow(result.data);
      const membershipCode = Array.isArray(membership?.families)
        ? membership.families[0]?.code
        : membership?.families?.code;
      return {
        membership,
        valid: Boolean(
          !result.error &&
          membership &&
          membership.family_id === selectedFamilyId &&
          isFamilyRole(membership.role) &&
          membershipCode === selectedCode,
        ),
      };
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
      const operation = ++mutationGeneration;
      activeMutations += 1;
      try {
        await initialize();
        if (operation !== mutationGeneration) return null;
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
        if (operation !== mutationGeneration) return null;

        const row = singleRow(result.data);
        if (result.error || !isRpcRow(row)) {
          const error = backendError();
          onStatus("error", error.message);
          throw error;
        }

        adopt(row, "family");
        onStatus("synced");
        startRealtime(row, operation);
        return row.family_code;
      } finally {
        activeMutations -= 1;
      }
    }

    async function attach(code, selectedRole) {
      const normalizedCode = String(code ?? "").trim();
      if (!isFamilyCode(normalizedCode)) {
        throw lifecycleError("FAMILY_NOT_FOUND", "Family not found.");
      }
      if (!isFamilyRole(selectedRole)) throw backendError();

      const operation = ++mutationGeneration;
      activeMutations += 1;
      try {
        await initialize();
        if (operation !== mutationGeneration) return state;
        onStatus("loading");

        let result;
        try {
          result = await client.rpc("join_family", {
            family_code: normalizedCode,
            requested_role: selectedRole,
          });
        } catch (_error) {
          result = { data: null, error: true };
        }
        if (operation !== mutationGeneration) return state;

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
        if (!isRpcRow(row)) {
          const error = backendError();
          onStatus("error", error.message);
          throw error;
        }

        const membershipResult = await readMembership(row.family_id, row.family_code);
        if (operation !== mutationGeneration) return state;
        const { membership, valid } = validMembership(
          membershipResult,
          row.family_id,
          row.family_code,
        );
        if (!valid) {
          const error = backendError();
          onStatus("error", error.message);
          throw error;
        }

        adopt(row, membership.role);
        onStatus("synced");
        startRealtime(row, operation);
        return state;
      } finally {
        activeMutations -= 1;
      }
    }

    async function restoreSelection() {
      const operation = mutationGeneration;
      if (activeMutations > 0) return state;
      const cachedFamilyId = readSelection(FAMILY_ID_KEY);
      const cachedCode = readSelection(FAMILY_CODE_KEY);
      const cachedRole = readSelection(FAMILY_ROLE_KEY);

      if (!isFamilyId(cachedFamilyId) || !isFamilyCode(cachedCode) || !isFamilyRole(cachedRole)) {
        clearSelection();
        return null;
      }

      await initialize();
      if (operation !== mutationGeneration) return state;
      onStatus("loading");

      const membershipResult = await readMembership(cachedFamilyId, cachedCode);
      if (operation !== mutationGeneration) return state;

      if (membershipResult.error) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      const { membership, valid } = validMembership(membershipResult, cachedFamilyId, cachedCode);
      if (!valid || membership.role !== cachedRole) {
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
      if (operation !== mutationGeneration) return state;

      const row = singleRow(stateResult.data);
      const restoredRow = row && { ...row, family_code: cachedCode };
      if (stateResult.error || !isRpcRow(restoredRow)) {
        const error = backendError();
        onStatus("error", error.message);
        throw error;
      }

      adopt(restoredRow, cachedRole);
      onStatus("synced");
      startRealtime(restoredRow, operation);
      return state;
    }

    async function callReplace(targetFamilyId, expectedRevision, nextPayload) {
      try {
        return {
          offline: false,
          result: await client.rpc("replace_family_state", {
            target_family_id: targetFamilyId,
            expected_revision: expectedRevision,
            next_payload: nextPayload,
          }),
        };
      } catch (_error) {
        return { offline: true, result: { data: null, error: true } };
      }
    }

    async function readFamilyState(targetFamilyId, selectedCode) {
      let result;
      try {
        result = await client
          .from("family_states")
          .select("family_id, revision, payload")
          .eq("family_id", targetFamilyId)
          .maybeSingle();
      } catch (_error) {
        return { offline: true, row: null };
      }

      const row = singleRow(result.data);
      if (result.error || !isStateRow(row, targetFamilyId, selectedCode)) {
        return { offline: false, row: null };
      }
      return { offline: false, row };
    }

    function reportWriteFailure(operation, status, error) {
      if (operation === mutationGeneration) onStatus(status, error.message);
      return error;
    }

    function acceptWrite(row, targetFamilyId, operation, writeNumber, expectedRevision) {
      if (
        !isRpcRow(row) ||
        row.family_id !== targetFamilyId ||
        Number(row.revision) <= expectedRevision
      ) {
        throw backendError();
      }

      if (operation === mutationGeneration && targetFamilyId === familyId) {
        const acceptedRevision = Number(row.revision);
        if (acceptedRevision >= revision) {
          revision = acceptedRevision;
          confirmedState = row.payload;
          if (writeNumber === optimisticWrite) {
            state = row.payload;
            emit();
          }
        }
      }
      return row.payload;
    }

    async function persistUpdate({
      draft,
      mutator,
      operation,
      selectedCode,
      startingRevision,
      targetFamilyId,
      writeNumber,
    }) {
      const expectedRevision =
        operation === mutationGeneration && targetFamilyId === familyId
          ? revision
          : startingRevision;
      let nextPayload = draft;
      if (
        operation === mutationGeneration &&
        targetFamilyId === familyId &&
        confirmedState &&
        expectedRevision !== startingRevision
      ) {
        nextPayload = structuredClone(confirmedState);
        mutator(nextPayload);
      }
      const firstAttempt = await callReplace(targetFamilyId, expectedRevision, nextPayload);

      if (!firstAttempt.result.error) {
        try {
          return acceptWrite(
            singleRow(firstAttempt.result.data),
            targetFamilyId,
            operation,
            writeNumber,
            expectedRevision,
          );
        } catch (_error) {
          throw reportWriteFailure(operation, "error", backendError());
        }
      }

      if (!isRevisionConflict(firstAttempt.result.error)) {
        throw reportWriteFailure(
          operation,
          firstAttempt.offline ? "offline" : "error",
          backendError(),
        );
      }

      const freshResult = await readFamilyState(targetFamilyId, selectedCode);
      if (!freshResult.row || Number(freshResult.row.revision) <= expectedRevision) {
        throw reportWriteFailure(
          operation,
          freshResult.offline ? "offline" : "error",
          backendError(),
        );
      }

      const freshRow = freshResult.row;
      if (operation === mutationGeneration && targetFamilyId === familyId) {
        revision = Number(freshRow.revision);
        confirmedState = freshRow.payload;
      }
      const rebasedDraft = structuredClone(freshRow.payload);
      mutator(rebasedDraft);
      const retry = await callReplace(targetFamilyId, Number(freshRow.revision), rebasedDraft);

      if (!retry.result.error) {
        try {
          return acceptWrite(
            singleRow(retry.result.data),
            targetFamilyId,
            operation,
            writeNumber,
            Number(freshRow.revision),
          );
        } catch (_error) {
          if (operation === mutationGeneration && targetFamilyId === familyId) {
            revision = Number(freshRow.revision);
            state = freshRow.payload;
            confirmedState = freshRow.payload;
            emit();
          }
          throw reportWriteFailure(operation, "error", backendError());
        }
      }

      if (operation === mutationGeneration && targetFamilyId === familyId) {
        revision = Number(freshRow.revision);
        state = freshRow.payload;
        confirmedState = freshRow.payload;
        emit();
      }

      const retryError = isRevisionConflict(retry.result.error)
        ? revisionConflictError()
        : backendError();
      throw reportWriteFailure(operation, retry.offline ? "offline" : "error", retryError);
    }

    function update(mutator) {
      if (!state || !familyId || typeof mutator !== "function") {
        const error = backendError();
        onStatus("error", error.message);
        return Promise.reject(error);
      }

      const operation = mutationGeneration;
      const targetFamilyId = familyId;
      const selectedCode = state.code;
      const startingRevision = revision;
      const draft = structuredClone(state);
      mutator(draft);
      const writeNumber = ++optimisticWrite;

      state = draft;
      pendingWrites += 1;
      onStatus("saving");
      emit();

      const persistence = writeQueue.then(() =>
        persistUpdate({
          draft,
          mutator,
          operation,
          selectedCode,
          startingRevision,
          targetFamilyId,
          writeNumber,
        }),
      );
      writeQueue = persistence.catch(() => {});

      return persistence.then(
        (acceptedState) => {
          pendingWrites -= 1;
          if (
            operation === mutationGeneration &&
            targetFamilyId === familyId &&
            pendingWrites === 0
          ) {
            onStatus("synced");
          }
          return acceptedState;
        },
        (error) => {
          pendingWrites -= 1;
          throw error;
        },
      );
    }

    function resetFamily() {
      if (!state || !familyId) return update(null);
      const freshState = newFamily(state.code, state.lang || "zh");
      return update((draft) => {
        Object.keys(draft).forEach((key) => delete draft[key]);
        Object.assign(draft, structuredClone(freshState));
      });
    }

    async function signOut() {
      mutationGeneration += 1;
      clearSelection();
      emit();
      onStatus("synced");
    }

    return {
      initialize,
      create,
      attach,
      restoreSelection,
      update,
      resetFamily,
      signOut,
      get: () => state,
      role: () => selectedRole,
      subscribe: (subscriber) => subscribers.push(subscriber),
    };
  }

  global.createSupabaseStore = createSupabaseStore;
})(typeof window === "undefined" ? globalThis : window);
