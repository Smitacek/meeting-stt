import React, { createContext, useState, useContext, ReactNode } from 'react';
import h1 from '@/assets/h1.png';

// Utility function to generate a random GUID
const generateSessionId = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

interface UserInfo {
  name: string;
  email: string;
  avatar: string;
  sessionId: string;
}

interface UserContextType {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
}

const defaultUserInfo: UserInfo = {
  name: "Jon Doe",
  email: "johne@microsoft.com",
  avatar: h1,
  sessionId: generateSessionId(),
};

export const UserContext = createContext<UserContextType>({
  userInfo: defaultUserInfo,
  setUserInfo: () => {},
});

export const useUserContext = () => useContext(UserContext);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [userInfo, setUserInfo] = useState<UserInfo>(defaultUserInfo);

  return (
    <UserContext.Provider value={{ userInfo, setUserInfo }}>
      {children}
    </UserContext.Provider>
  );
};

export async function getUserInfo() {
  try {
    const response = await fetch('/.auth/me');
    const payload = await response.json();
    const { clientPrincipal } = payload;

    // Extract the username from the email
    const email = clientPrincipal.userDetails;
    const username = email.split('@')[0];

    return {
      name: username,
      email: email,
      avatar: h1,
      sessionId: generateSessionId(),
    };
  } catch (error) {
    // console.error("Failed to fetch user info:", error);
    return defaultUserInfo;
  }
}
