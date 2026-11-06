"use client";

import { createContext, useContext } from "react";
import type { TokenUser } from "@/lib/auth";

export const WorkspaceUserContext = createContext<TokenUser | undefined>(undefined);
export const useWorkspaceUser = () => useContext(WorkspaceUserContext);
